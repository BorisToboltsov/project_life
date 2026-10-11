from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid7

from fastapi import APIRouter, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import delete, exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, OpenFoodFactsDep
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import BarcodeMiss, Product, Role, User
from app.nutrition import ProductSource
from app.schemas import (
    BarcodeLookupIn,
    BarcodeLookupOut,
    LookupStatus,
    ProductDraftOut,
    ProductIn,
    ProductOut,
    RecordId,
)
from app.services.open_food_facts import Miss, OffProduct

router = APIRouter(prefix="/products", tags=["nutrition"])

# Столько продуктов отдаёт поиск: дальше запрос стоит уточнить.
SEARCH_LIMIT = 50
# Столько помнится, что штрихкода нет в источнике: за это время продукт там мог появиться.
MISS_TTL = timedelta(days=7)


def _may_edit(product: Product, user: User) -> bool:
    return user.role == Role.ADMIN or product.created_by == user.id


def _barcode_taken() -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, ErrorCode.BARCODE_TAKEN)


@router.get("")
async def search_products(
    user: CurrentUser, db: SessionDep, q: Annotated[str, Query(max_length=120)] = ""
) -> list[ProductOut]:
    """Продукты каталога по алфавиту; `q` — слова, которые есть в названии, в любом порядке."""
    query = select(Product).order_by(func.lower(Product.name), Product.id).limit(SEARCH_LIMIT)
    for word in q.split():
        query = query.where(Product.name.icontains(word, autoescape=True))
    products = await db.scalars(query)
    return [ProductOut.of(product, user) for product in products]


async def _with_barcode(db: AsyncSession, barcode: str) -> Product | None:
    return await db.scalar(select(Product).where(Product.barcode == barcode))


async def _is_remembered_miss(db: AsyncSession, barcode: str) -> bool:
    fresh = BarcodeMiss.checked_at > datetime.now(UTC) - MISS_TTL
    return bool(await db.scalar(select(exists().where(BarcodeMiss.barcode == barcode, fresh))))


async def _remember_miss(db: AsyncSession, barcode: str) -> None:
    await db.execute(
        delete(BarcodeMiss).where(BarcodeMiss.checked_at <= datetime.now(UTC) - MISS_TTL)
    )
    statement = insert(BarcodeMiss).values(barcode=barcode)
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[BarcodeMiss.barcode], set_={"checked_at": func.now()}
        )
    )
    await db.commit()


def _complete(found: OffProduct, barcode: str) -> ProductIn | None:
    """Продукт каталога из найденного в источнике; `None` — чего-то не хватает или состав
    невозможен: ограничения те же, что у ручного ввода."""
    try:
        return ProductIn.model_validate(
            {
                "name": found.name,
                "unit": found.unit,
                "kcal": found.kcal,
                "protein_g": found.protein_g,
                "fat_g": found.fat_g,
                "carbs_g": found.carbs_g,
                "barcode": barcode,
            }
        )
    except ValidationError:
        return None


@router.post("/lookup", responses=error_responses(429))
async def lookup_barcode(
    body: BarcodeLookupIn, user: CurrentUser, db: SessionDep, source: OpenFoodFactsDep
) -> BarcodeLookupOut:
    """Продукт по штрихкоду: свой каталог → память о ненайденном → Open Food Facts.

    Полный продукт из источника сразу сохраняется в каталог, неполный возвращается
    черновиком для формы создания (ADR 0009).
    """
    barcode = body.barcode

    def answer(outcome: LookupStatus, product: Product | None = None) -> BarcodeLookupOut:
        return BarcodeLookupOut(
            status=outcome,
            barcode=barcode,
            product=ProductOut.of(product, user) if product else None,
        )

    if product := await _with_barcode(db, barcode):
        return answer(LookupStatus.FOUND, product)
    if not source.enabled or await _is_remembered_miss(db, barcode):
        return answer(LookupStatus.NOT_FOUND)
    if not source.admits(user.id):
        raise ApiError(status.HTTP_429_TOO_MANY_REQUESTS, ErrorCode.TOO_MANY_ATTEMPTS)
    # Запрос наружу длится секунды: соединение с базой на это время возвращается в пул.
    await db.commit()

    found = await source.product(barcode, user.language)
    if found is Miss.UNAVAILABLE:
        return answer(LookupStatus.UNAVAILABLE)
    if found is Miss.NOT_FOUND:
        await _remember_miss(db, barcode)
        return answer(LookupStatus.NOT_FOUND)

    fields = _complete(found, barcode)
    if fields is None:
        return BarcodeLookupOut(
            status=LookupStatus.DRAFT, barcode=barcode, draft=ProductDraftOut.of(found)
        )
    # Ключ выдаёт сервер: от дублей защищает уникальность штрихкода, а не ключ клиента.
    product = Product(
        id=uuid7(),
        created_by=user.id,
        source=ProductSource.OPEN_FOOD_FACTS,
        **fields.model_dump(),
    )
    db.add(product)
    try:
        await db.commit()
    except IntegrityError:
        # Тот же штрихкод только что сохранил параллельный запрос — отдаём его продукт.
        await db.rollback()
        await db.refresh(user)
        product = await _with_barcode(db, barcode)
    return answer(LookupStatus.FOUND if product else LookupStatus.UNAVAILABLE, product)


@router.get("/{product_id}", responses=error_responses(404))
async def read_product(product_id: RecordId, user: CurrentUser, db: SessionDep) -> ProductOut:
    product = await db.get(Product, product_id)
    if product is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return ProductOut.of(product, user)


@router.put(
    "/{product_id}",
    responses={201: {"model": ProductOut}, **error_responses(403, 409)},
)
async def save_product(
    product_id: RecordId,
    body: ProductIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> ProductOut:
    """Создаёт продукт или заменяет свой: повтор запроса не плодит дубли (ADR 0002).

    Записи дневника хранят снимок состава — правка продукта их не меняет (инвариант I10).
    Штрихкод, который уже носит другой продукт, — отказ 409.
    """
    fields = body.model_dump()
    product = await db.get(Product, product_id, with_for_update=True)
    if product is None:
        product = Product(id=product_id, created_by=user.id, **fields)
        db.add(product)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Отказала уникальность ключа — его только что создал параллельный запрос, и
            # дальше это замена — либо уникальность штрихкода: тогда продукта с ключом нет.
            await db.rollback()
            await db.refresh(user)
            product = await db.get(Product, product_id, with_for_update=True)
            if product is None:
                raise _barcode_taken() from None
    if not _may_edit(product, user):
        raise ApiError(status.HTTP_403_FORBIDDEN, ErrorCode.FORBIDDEN)
    for name, value in fields.items():
        setattr(product, name, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _barcode_taken() from None
    return ProductOut.of(product, user)


@router.delete(
    "/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(403, 404),
)
async def delete_product(product_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    """Убирает продукт из каталога. Записи дневника с ним остаются — со своим снимком."""
    product = await db.get(Product, product_id, with_for_update=True)
    if product is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    if not _may_edit(product, user):
        raise ApiError(status.HTTP_403_FORBIDDEN, ErrorCode.FORBIDDEN)
    await db.delete(product)
    await db.commit()
