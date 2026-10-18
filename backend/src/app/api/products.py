import hashlib
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import uuid7

from fastapi import APIRouter, Header, Query, Response, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import delete, exists, func, select, text
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
    DishIn,
    ExternalProductOut,
    ExternalSearchOut,
    ExternalSearchStatus,
    LookupStatus,
    ProductDraftOut,
    ProductIn,
    ProductOut,
    RecordId,
)
from app.services.open_food_facts import (
    SEARCH_MAX_PAGE,
    SEARCH_MIN_LENGTH,
    Miss,
    OffListing,
    OffProduct,
    search_terms,
)

router = APIRouter(prefix="/products", tags=["nutrition"])

# Столько продуктов каталога на странице: остальное приходит по «Показать ещё».
PAGE_SIZE = 20
# Заголовок ответа: с какого продукта продолжать. Нет заголовка — список кончился.
NEXT_OFFSET = "X-Next-Offset"
# Столько помнится, что штрихкода нет в источнике: за это время продукт там мог появиться.
MISS_TTL = timedelta(days=7)


def _may_edit(product: Product, user: User) -> bool:
    return user.role == Role.ADMIN or product.created_by == user.id


def _barcode_taken() -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, ErrorCode.BARCODE_TAKEN)


@router.get(
    "",
    responses={
        200: {
            "headers": {
                NEXT_OFFSET: {
                    "description": "С какого продукта продолжать; нет — список кончился.",
                    "schema": {"type": "integer"},
                }
            }
        }
    },
)
async def search_products(
    user: CurrentUser,
    db: SessionDep,
    response: Response,
    q: Annotated[str, Query(max_length=120)] = "",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    kind: Literal["all", "products", "dishes"] = "all",
) -> list[ProductOut]:
    """Страница каталога по алфавиту; `q` — слова, которые есть в названии, в любом порядке,
    `offset` — сколько продуктов уже показано.

    Ответ — список, как до появления страниц: открытая вкладка прежней версии приложения
    читает его по-прежнему. Откуда продолжать, говорит заголовок (ADR 0010).
    """
    # Один продукт сверх страницы говорит, есть ли следующая.
    query = (
        select(Product)
        .order_by(func.lower(Product.name), Product.id)
        .offset(offset)
        .limit(PAGE_SIZE + 1)
    )
    if kind != "all":
        query = query.where(
            Product.recipe.is_not(None) if kind == "dishes" else Product.recipe.is_(None)
        )
    for word in q.split():
        query = query.where(Product.name.icontains(word, autoescape=True))
    products = list(await db.scalars(query))
    if len(products) > PAGE_SIZE:
        response.headers[NEXT_OFFSET] = str(offset + PAGE_SIZE)
    return [ProductOut.of(product, user) for product in products[:PAGE_SIZE]]


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
                "sugars_g": found.sugars_g,
                "saturated_fat_g": found.saturated_fat_g,
                "fiber_g": found.fiber_g,
                "salt_g": found.salt_g,
                "serving_size": found.serving_size,
                "package_size": found.package_size,
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


@router.get("/external", responses=error_responses(429))
async def search_open_food_facts(
    user: CurrentUser,
    db: SessionDep,
    source: OpenFoodFactsDep,
    q: Annotated[str, Query(max_length=120)] = "",
    page: Annotated[int, Query(ge=1, le=SEARCH_MAX_PAGE)] = 1,
) -> ExternalSearchOut:
    """Продукты Open Food Facts по названию — те, которых ещё нет в каталоге (ADR 0010).

    Поиск ничего не сохраняет: в каталог продукт попадает, когда его выберут, — запросом
    по штрихкоду, как при сканировании.
    """

    def answer(
        outcome: ExternalSearchStatus, items: list[ExternalProductOut], next_page: int | None = None
    ) -> ExternalSearchOut:
        return ExternalSearchOut(status=outcome, items=items, next_page=next_page)

    text = search_terms(q)
    if not source.searchable or len(text) < SEARCH_MIN_LENGTH:
        return answer(ExternalSearchStatus.OK, [])
    found = source.recalled(text, page)
    if found is None:
        if not source.admits_search(user.id):
            raise ApiError(status.HTTP_429_TOO_MANY_REQUESTS, ErrorCode.TOO_MANY_ATTEMPTS)
        # Запрос наружу длится секунды: соединение с базой на это время возвращается в пул.
        await db.commit()
        found = await source.search(text, page)
    if isinstance(found, Miss):
        return answer(ExternalSearchStatus.UNAVAILABLE, [])

    # Один штрихкод — одна строка: в источнике бывают дубли.
    listed: dict[str, OffListing] = {}
    for listing in found.products(user.language):
        listed.setdefault(listing.barcode, listing)
    # Что уже есть в каталоге, находится своим поиском — второй раз не показывается.
    known = set(await db.scalars(select(Product.barcode).where(Product.barcode.in_(list(listed)))))
    return answer(
        ExternalSearchStatus.OK,
        [ExternalProductOut.of(listing) for code, listing in listed.items() if code not in known],
        page + 1 if found.has_more else None,
    )


@router.get(
    "/catalog",
    response_model=list[ProductOut],
    responses={304: {"description": "Каталог не изменился с прошлого ответа"}},
)
async def whole_catalog(
    user: CurrentUser,
    db: SessionDep,
    if_none_match: Annotated[str | None, Header()] = None,
) -> list[ProductOut] | Response:
    """Каталог целиком — копия для работы без сети (ADR 0020). Метка `ETag` меняется, когда
    продукт добавили, исправили или удалили; с прежней меткой в `If-None-Match` ответ — 304
    без тела. В метку входит и тот, кто спрашивает: от него зависит `editable`."""
    products = list(
        await db.scalars(select(Product).order_by(func.lower(Product.name), Product.id))
    )
    digest = hashlib.sha256(f"{user.id}:{user.role}".encode())
    for product in products:
        digest.update(f"|{product.id}:{product.updated_at.isoformat()}".encode())
    etag = f'"{digest.hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return JSONResponse(
        [ProductOut.of(product, user).model_dump(mode="json") for product in products],
        headers=headers,
    )


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
    body: ProductIn | DishIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> ProductOut:
    """Создаёт продукт или заменяет свой: повтор запроса не плодит дубли (ADR 0002).

    Записи дневника хранят снимок состава — правка продукта их не меняет (инвариант I10).
    Штрихкод, который уже носит другой продукт, — отказ 409.
    """
    # Сериализуем изменения каталога: два параллельных рецепта не создадут цикл.
    await db.execute(text("SELECT pg_advisory_xact_lock(909000)"))
    product = await db.get(Product, product_id, with_for_update=True)
    if product is not None and not _may_edit(product, user):
        raise ApiError(status.HTTP_403_FORBIDDEN, ErrorCode.FORBIDDEN)
    if isinstance(body, DishIn):
        from app.services.recipes import build_recipe

        fields = await build_recipe(db, product_id, body, product)
    else:
        if product is not None and product.recipe is not None:
            raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.INVALID_RECIPE)
        fields = body.model_dump()

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
