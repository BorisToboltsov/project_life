from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import Row, Subquery, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import FoodEntry, NutritionGoal, Product, User
from app.nutrition import Meal, total
from app.schemas import (
    DiaryCopyIn,
    DiaryDate,
    DiaryDayOut,
    FoodEntryIn,
    FoodEntryOut,
    MealOut,
    NutrientsOut,
    NutritionGoalIn,
    NutritionGoalOut,
    ProductOut,
    RecordId,
    SuggestionOut,
    SuggestionsOut,
)

router = APIRouter(prefix="/diary", tags=["nutrition"])

# Столько продуктов в каждой подсказке — «недавние» и «частые».
SUGGESTIONS = 10
# «Частый» продукт — внесённый хотя бы дважды за это время.
FREQUENT_WINDOW = timedelta(days=90)

_IN_ORDER = (FoodEntry.created_at, FoodEntry.id)


async def _goal_on(db: AsyncSession, user_id: UUID, day: date) -> NutritionGoal | None:
    """Цель, действовавшая в этот день: последняя из начавшихся не позже него."""
    return await db.scalar(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == user_id, NutritionGoal.effective_from <= day)
        .order_by(NutritionGoal.effective_from.desc())
        .limit(1)
    )


@router.get("")
async def read_day(
    user: CurrentUser, db: SessionDep, day: Annotated[DiaryDate, Query(alias="date")]
) -> DiaryDayOut:
    """День дневника: записи по приёмам пищи, съеденное за приём и за день, цель дня."""
    entries = list(
        await db.scalars(
            select(FoodEntry)
            .where(FoodEntry.user_id == user.id, FoodEntry.local_date == day)
            .order_by(*_IN_ORDER)
        )
    )
    goal = await _goal_on(db, user.id, day)
    meals = [
        MealOut(
            meal=meal,
            entries=[FoodEntryOut.of_entry(entry) for entry in entries if entry.meal == meal],
            totals=NutrientsOut.of(total(entry.eaten for entry in entries if entry.meal == meal)),
        )
        for meal in Meal
    ]
    return DiaryDayOut(
        local_date=day,
        meals=meals,
        totals=NutrientsOut.of(total(entry.eaten for entry in entries)),
        goal=NutritionGoalOut.model_validate(goal) if goal else None,
    )


def _last_use(user: User) -> Subquery:
    """Последняя запись пользователя с каждым продуктом каталога."""
    recency = (
        func.row_number()
        .over(partition_by=FoodEntry.product_id, order_by=FoodEntry.created_at.desc())
        .label("recency")
    )
    ranked = (
        select(FoodEntry.product_id, FoodEntry.amount_g, FoodEntry.created_at, recency)
        .where(FoodEntry.user_id == user.id, FoodEntry.product_id.is_not(None))
        .subquery()
    )
    return select(ranked).where(ranked.c.recency == 1).subquery()


@router.get("/suggestions")
async def suggest_products(user: CurrentUser, db: SessionDep) -> SuggestionsOut:
    """Продукты, которые пользователь вносил недавно и вносит часто, с прошлой граммовкой."""
    last = _last_use(user)
    recent = await db.execute(
        select(Product, last.c.amount_g)
        .join(last, last.c.product_id == Product.id)
        .order_by(last.c.created_at.desc(), Product.id)
        .limit(SUGGESTIONS)
    )
    uses = (
        select(FoodEntry.product_id, func.count().label("times"))
        .where(
            FoodEntry.user_id == user.id,
            FoodEntry.created_at >= datetime.now(UTC) - FREQUENT_WINDOW,
        )
        .group_by(FoodEntry.product_id)
        .having(func.count() > 1)
        .subquery()
    )
    frequent = await db.execute(
        select(Product, last.c.amount_g)
        .join(last, last.c.product_id == Product.id)
        .join(uses, uses.c.product_id == Product.id)
        .order_by(uses.c.times.desc(), func.lower(Product.name), Product.id)
        .limit(SUGGESTIONS)
    )

    def suggestions(rows: Iterable[Row[Product, Decimal]]) -> list[SuggestionOut]:
        return [
            SuggestionOut(**ProductOut.of(product, user).model_dump(), amount_g=float(amount_g))
            for product, amount_g in rows
        ]

    return SuggestionsOut(recent=suggestions(recent), frequent=suggestions(frequent))


async def _own_entry(db: AsyncSession, entry_id: UUID, user_id: UUID) -> FoodEntry | None:
    """Запись пользователя; чужая неотличима от несуществующей (инвариант I5)."""
    entry = await db.get(FoodEntry, entry_id, with_for_update=True)
    if entry is not None and entry.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return entry


@router.put(
    "/entries/{entry_id}",
    responses={201: {"model": FoodEntryOut}, **error_responses(404)},
)
async def save_entry(
    entry_id: RecordId,
    body: FoodEntryIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> FoodEntryOut:
    """Создаёт запись или заменяет свою же: повтор запроса не плодит дубли (ADR 0002).

    Состав продукта снимается в запись при создании и при смене продукта. Пока продукт
    тот же, снимок прежний — даже если продукт в каталоге с тех пор исправили.
    """
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    entry = await _own_entry(db, entry_id, user_id)
    if entry is None or body.product_id not in (None, entry.product_id):
        product = await db.get(Product, body.product_id) if body.product_id else None
        if product is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.PRODUCT_NOT_FOUND)
        snapshot = {
            "product_id": product.id,
            "product_name": product.name,
            "kcal": product.kcal,
            "protein_g": product.protein_g,
            "fat_g": product.fat_g,
            "carbs_g": product.carbs_g,
        }
    else:
        snapshot = {}
    fields = {
        "local_date": body.local_date,
        "meal": body.meal,
        "amount_g": body.amount_g,
        **snapshot,
    }
    if entry is None:
        entry = FoodEntry(id=entry_id, user_id=user_id, **fields)
        db.add(entry)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своей записи либо отказ, если запись чужая.
            await db.rollback()
            entry = await _own_entry(db, entry_id, user_id)
    if entry is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    for name, value in fields.items():
        setattr(entry, name, value)
    await db.commit()
    return FoodEntryOut.of_entry(entry)


@router.delete(
    "/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_entry(entry_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    entry = await _own_entry(db, entry_id, user.id)
    if entry is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(entry)
    await db.commit()


@router.post("/copy", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404))
async def copy_entries(body: DiaryCopyIn, user: CurrentUser, db: SessionDep) -> None:
    """Копирует свои записи на другой день вместе со снимками.

    Ключи копий выбирает клиент, так что повтор запроса ничего не дублирует.
    """
    wanted = {item.source_id for item in body.items}
    sources = {
        entry.id: entry
        for entry in await db.scalars(
            select(FoodEntry).where(FoodEntry.user_id == user.id, FoodEntry.id.in_(wanted))
        )
    }
    if len(sources) != len(wanted):
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    # Порядок записей в приёме пищи — по времени создания: копии встают в порядке запроса.
    now = datetime.now(UTC)
    copies = [
        {
            "id": item.id,
            "user_id": user.id,
            "local_date": body.to_date,
            "meal": body.to_meal or source.meal,
            "amount_g": source.amount_g,
            "product_id": source.product_id,
            "product_name": source.product_name,
            "kcal": source.kcal,
            "protein_g": source.protein_g,
            "fat_g": source.fat_g,
            "carbs_g": source.carbs_g,
            "created_at": now + timedelta(microseconds=index),
        }
        for index, item in enumerate(body.items)
        for source in [sources[item.source_id]]
    ]
    await db.execute(insert(FoodEntry).values(copies).on_conflict_do_nothing())
    await db.commit()


@router.get("/goal")
async def read_goal(user: CurrentUser, db: SessionDep) -> NutritionGoalOut | None:
    """Действующая цель на день; `null`, пока она не задана."""
    goal = await db.scalar(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == user.id)
        .order_by(NutritionGoal.effective_from.desc())
        .limit(1)
    )
    return NutritionGoalOut.model_validate(goal) if goal else None


@router.put("/goal")
async def save_goal(body: NutritionGoalIn, user: CurrentUser, db: SessionDep) -> NutritionGoalOut:
    """Задаёт цель с сегодняшнего дня. Прошлые дни остаются со своей прежней целью."""
    targets = body.model_dump(exclude={"local_date"})
    statement = insert(NutritionGoal).values(
        user_id=user.id, effective_from=body.local_date, **targets
    )
    statement = statement.on_conflict_do_update(
        index_elements=[NutritionGoal.user_id, NutritionGoal.effective_from],
        set_={**targets, "updated_at": func.now()},
    )
    await db.execute(statement)
    await db.commit()
    return NutritionGoalOut(effective_from=body.local_date, **targets)
