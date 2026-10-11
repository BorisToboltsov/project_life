import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from tests.conftest import MakeUser
from tests.nutrition import COTTAGE_CHEESE, OATMEAL, add_product, put_product

pytestmark = pytest.mark.anyio


async def search(client: AsyncClient, headers: dict[str, str], q: str | None = None) -> list[str]:
    response = await client.get("/api/products", params={"q": q} if q else {}, headers=headers)
    assert response.status_code == 200
    return [product["name"] for product in response.json()]


# --- Создание и правка -------------------------------------------------------------------


async def test_product_is_created_with_the_client_id(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user()
    product_id = str(uuid.uuid7())

    response = await put_product(client, author, {**COTTAGE_CHEESE, "name": "  Творог 5 %  "})
    again = await put_product(client, author, COTTAGE_CHEESE, product_id)

    assert response.status_code == 201
    assert response.json() == {**COTTAGE_CHEESE, "id": response.json()["id"], "editable": True}
    assert again.json()["id"] == product_id


async def test_repeated_request_does_not_duplicate(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user()
    product_id = str(uuid.uuid7())

    first = await put_product(client, author, COTTAGE_CHEESE, product_id)
    again = await put_product(client, author, COTTAGE_CHEESE, product_id)

    assert (first.status_code, again.status_code) == (201, 200)
    assert await search(client, author.headers) == ["Творог 5 %"]


async def test_author_corrects_the_product(client: AsyncClient, make_user: MakeUser) -> None:
    author = await make_user()
    product_id = await add_product(client, author)

    response = await put_product(client, author, {**COTTAGE_CHEESE, "kcal": 145.5}, product_id)
    read = await client.get(f"/api/products/{product_id}", headers=author.headers)

    assert response.status_code == 200
    assert read.json()["kcal"] == 145.5


async def test_catalog_is_shared_but_only_the_author_and_admin_edit(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author, reader, admin = await make_user(), await make_user(), await make_user(admin=True)
    product_id = await add_product(client, author)
    path = f"/api/products/{product_id}"

    seen = await client.get(path, headers=reader.headers)
    refused = await put_product(client, reader, OATMEAL, product_id)
    not_deleted = await client.delete(path, headers=reader.headers)
    fixed = await put_product(client, admin, {**COTTAGE_CHEESE, "name": "Творог 5%"}, product_id)

    assert seen.json()["editable"] is False
    assert (refused.status_code, not_deleted.status_code) == (403, 403)
    assert fixed.status_code == 200
    assert fixed.json()["editable"] is True
    # Правка администратора не делает его автором.
    assert (await client.get(path, headers=author.headers)).json() == {
        **COTTAGE_CHEESE,
        "name": "Творог 5%",
        "id": product_id,
        "editable": True,
    }


async def test_product_outlives_its_author_and_goes_to_the_admin(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    author, reader, admin = await make_user(), await make_user(), await make_user(admin=True)
    product_id = await add_product(client, author)
    await db.execute(delete(User).where(User.id == uuid.UUID(author.id)))
    await db.commit()

    seen = await client.get(f"/api/products/{product_id}", headers=reader.headers)
    fixed = await put_product(client, admin, OATMEAL, product_id)

    assert seen.json()["editable"] is False
    assert fixed.status_code == 200


async def test_product_is_deleted_by_its_author(client: AsyncClient, make_user: MakeUser) -> None:
    author = await make_user()
    path = f"/api/products/{await add_product(client, author)}"

    deleted = await client.delete(path, headers=author.headers)
    again = await client.delete(path, headers=author.headers)
    read = await client.get(path, headers=author.headers)

    assert (deleted.status_code, again.status_code, read.status_code) == (204, 404, 404)
    assert read.json() == {"detail": "not_found"}


@pytest.mark.parametrize(
    "fields",
    [
        {"name": "   "},
        {"name": "я" * 121},
        {"kcal": -1},
        {"kcal": 900.1},
        {"kcal": 12.34},
        {"protein_g": -0.1},
        {"fat_g": 100.01},
        {"carbs_g": 1.234},
        {"unit": "kg"},
        {"unit": ...},
        # Белки, жиры и углеводы вместе не помещаются в 100 г.
        {"protein_g": 40, "fat_g": 40, "carbs_g": 20.01},
        {"barcode": "4600000000000"},
    ],
)
async def test_implausible_product_is_rejected(
    client: AsyncClient, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    author = await make_user()

    body = {**COTTAGE_CHEESE, **fields}

    response = await put_product(
        client, author, {name: value for name, value in body.items() if value is not ...}
    )

    assert response.status_code == 422
    assert await search(client, author.headers) == []


async def test_pure_fat_and_empty_water_are_products_too(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user()
    oil = {**COTTAGE_CHEESE, "name": "Масло оливковое", "kcal": 899, "protein_g": 0}
    oil = {**oil, "fat_g": 99.9, "carbs_g": 0}
    water = {"name": "Вода", "unit": "ml", "kcal": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0}

    assert (await put_product(client, author, oil)).status_code == 201
    assert (await put_product(client, author, water)).status_code == 201


async def test_product_is_measured_in_grams_or_millilitres(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user()
    kefir = {**COTTAGE_CHEESE, "name": "Кефир 1 %", "unit": "ml"}

    created = await put_product(client, author, kefir)
    corrected = await put_product(client, author, {**kefir, "unit": "g"}, created.json()["id"])

    assert (created.status_code, created.json()["unit"]) == (201, "ml")
    assert corrected.json()["unit"] == "g"


# --- Поиск -------------------------------------------------------------------------------


async def test_search_finds_words_in_any_order_and_case(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author, reader = await make_user(), await make_user()
    for name in ("Творог 5 %", "Творог зернёный", "Молоко 3,2 %", "молоко топлёное", "Хлеб"):
        await add_product(client, author, name=name)

    assert await search(client, reader.headers) == [
        "Молоко 3,2 %",
        "молоко топлёное",
        "Творог 5 %",
        "Творог зернёный",
        "Хлеб",
    ]
    assert await search(client, reader.headers, "МОЛОК") == ["Молоко 3,2 %", "молоко топлёное"]
    assert await search(client, reader.headers, "5 творог") == ["Творог 5 %"]
    assert await search(client, reader.headers, "кефир") == []


async def test_search_takes_wildcards_literally(client: AsyncClient, make_user: MakeUser) -> None:
    author = await make_user()
    for name in ("Творог 5 %", "Творог 9"):
        await add_product(client, author, name=name)

    assert await search(client, author.headers, "%") == ["Творог 5 %"]
    assert await search(client, author.headers, "_") == []


async def test_search_returns_a_limited_page(client: AsyncClient, make_user: MakeUser) -> None:
    author = await make_user()
    for number in range(52):
        await add_product(client, author, name=f"Продукт {number:02}")

    names = await search(client, author.headers)

    assert len(names) == 50
    assert names[0] == "Продукт 00"
