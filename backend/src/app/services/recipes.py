"""Атомарный расчёт рецепта из каталога и сохранённых снимков удалённых продуктов."""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, ErrorCode
from app.models import Product
from app.nutrition import ProductUnit
from app.schemas import DishIn, IngredientOut, ProductIn, RecipeOut


async def build_recipe(
    db: AsyncSession, identity: UUID, body: DishIn, previous: Product | None
) -> dict[str, Any]:
    def invalid() -> ApiError:
        return ApiError(422, ErrorCode.INVALID_RECIPE)

    old = RecipeOut.model_validate(previous.recipe) if previous and previous.recipe else None
    retained = {item.product_id: item.snapshot for item in old.ingredients} if old else {}
    catalog = {p.id: p for p in await db.scalars(select(Product))}
    # Проверяем достижимость без рекурсии и ограничений на глубину Python.
    pending = [item.product_id for item in body.ingredients]
    visited: set[UUID] = set()
    while pending:
        key = pending.pop()
        if key == identity:
            raise invalid()
        if key in visited:
            continue
        visited.add(key)
        product = catalog.get(key)
        if product and product.recipe:
            pending.extend(
                i.product_id for i in RecipeOut.model_validate(product.recipe).ingredients
            )
    ingredients: list[IngredientOut] = []
    for item in body.ingredients:
        product = catalog.get(item.product_id)
        snapshot = (
            ProductIn.model_validate(product, from_attributes=True)
            if product
            else retained.get(item.product_id)
        )
        if snapshot is None:
            raise ApiError(422, ErrorCode.PRODUCT_NOT_FOUND)
        if snapshot.unit == ProductUnit.ML and item.mass_g is None:
            raise invalid()
        if snapshot.unit == ProductUnit.G and item.mass_g not in (None, item.amount):
            raise invalid()
        ingredients.append(IngredientOut(**item.model_dump(), snapshot=snapshot))
    nutrients: dict[str, Decimal | None] = {}
    for field in (
        "kcal",
        "protein_g",
        "fat_g",
        "carbs_g",
        "sugars_g",
        "saturated_fat_g",
        "fiber_g",
        "salt_g",
    ):
        values = [getattr(item.snapshot, field) for item in ingredients]
        nutrients[field] = (
            None
            if None in values
            else (
                sum(
                    (value * item.amount for value, item in zip(values, ingredients, strict=True)),
                    Decimal(0),
                )
                / body.output_g
            ).quantize(Decimal("0.1" if field == "kcal" else "0.01"), rounding=ROUND_HALF_UP)
        )
    try:
        fields = ProductIn.model_validate(
            {
                "name": body.name,
                "unit": "g",
                "serving_size": body.serving_size,
                **nutrients,
            }
        ).model_dump()
    except ValidationError:
        raise invalid() from None
    fields["recipe"] = RecipeOut(output_g=float(body.output_g), ingredients=ingredients).model_dump(
        mode="json"
    )
    return fields
