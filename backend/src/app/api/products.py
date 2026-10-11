from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import Product, Role, User
from app.schemas import ProductIn, ProductOut, RecordId

router = APIRouter(prefix="/products", tags=["nutrition"])

# Столько продуктов отдаёт поиск: дальше запрос стоит уточнить.
SEARCH_LIMIT = 50


def _may_edit(product: Product, user: User) -> bool:
    return user.role == Role.ADMIN or product.created_by == user.id


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


@router.get("/{product_id}", responses=error_responses(404))
async def read_product(product_id: RecordId, user: CurrentUser, db: SessionDep) -> ProductOut:
    product = await db.get(Product, product_id)
    if product is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return ProductOut.of(product, user)


@router.put(
    "/{product_id}",
    responses={201: {"model": ProductOut}, **error_responses(403)},
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
            # Тот же ключ только что создал параллельный запрос — дальше это замена.
            await db.rollback()
            product = await db.get_one(Product, product_id, with_for_update=True)
    if not _may_edit(product, user):
        raise ApiError(status.HTTP_403_FORBIDDEN, ErrorCode.FORBIDDEN)
    for name, value in fields.items():
        setattr(product, name, value)
    await db.commit()
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
