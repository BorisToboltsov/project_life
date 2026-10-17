"""Рецепт сохраняет снимок; каталог и вложенные блюда не переписывают его."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.nutrition import COTTAGE_CHEESE, add_product, put_product

pytestmark = pytest.mark.anyio


async def test_recipe_snapshot(client: AsyncClient, make_user: MakeUser) -> None:
    owner = await make_user()
    ingredient = await add_product(client, owner)
    identity = str(uuid.uuid7())
    body: dict[str, Any] = {
        "name": "Сырники",
        "output_g": 200,
        "ingredients": [{"product_id": ingredient, "amount": 400}],
    }
    dish = await put_product(client, owner, body, identity)
    assert dish.status_code == 201, dish.text
    assert dish.json()["kcal"] == 242
    await put_product(client, owner, {**COTTAGE_CHEESE, "kcal": 100}, ingredient)
    path = f"/api/products/{identity}"
    assert (await client.get(path, headers=owner.headers)).json()["kcal"] == 242
    updated = await put_product(client, owner, body, identity)
    assert updated.json()["kcal"] == 200
    await client.delete(f"/api/products/{ingredient}", headers=owner.headers)
    kept = await put_product(client, owner, body, identity)
    assert kept.status_code == 200
    assert kept.json()["kcal"] == 200
    stranger = await make_user()
    assert (await put_product(client, stranger, body, identity)).status_code == 403


async def test_liquids_cycles_and_filters(client: AsyncClient, make_user: MakeUser) -> None:
    owner = await make_user()
    ingredient = await add_product(client, owner, unit="ml")
    identity = str(uuid.uuid7())
    body: dict[str, Any] = {
        "name": "Напиток",
        "output_g": 200,
        "ingredients": [{"product_id": ingredient, "amount": 200}],
    }
    assert (await put_product(client, owner, body, identity)).status_code == 422
    body["ingredients"][0]["mass_g"] = 205
    first = await put_product(client, owner, body, identity)
    assert first.status_code == 201
    assert first.json()["kcal"] == 121
    nested_id = str(uuid.uuid7())
    nested: dict[str, Any] = {
        "name": "Вложенное",
        "output_g": 100,
        "ingredients": [{"product_id": identity, "amount": 100}],
    }
    assert (await put_product(client, owner, nested, nested_id)).status_code == 201
    nested["ingredients"][0]["product_id"] = nested_id
    assert (await put_product(client, owner, nested, identity)).status_code == 422
    for kind, expected in [("products", [ingredient]), ("dishes", [nested_id, identity])]:
        found = await client.get("/api/products", params={"kind": kind}, headers=owner.headers)
        assert sorted(p["id"] for p in found.json()) == sorted(expected)


async def test_recipe_rejects_unknown_and_impossible_without_partial_write(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner = await make_user()
    ingredient = await add_product(client, owner)
    identity = str(uuid.uuid7())
    body: dict[str, Any] = {
        "name": "Блюдо",
        "output_g": 100,
        "ingredients": [{"product_id": ingredient, "amount": 100}],
    }
    first = await put_product(client, owner, body, identity)
    for broken in [
        {**body, "output_g": 1},
        {**body, "ingredients": [{"product_id": str(uuid.uuid7()), "amount": 100}]},
        {**body, "ingredients": [{"product_id": ingredient, "amount": 100, "mass_g": 50}]},
        COTTAGE_CHEESE,
    ]:
        assert (await put_product(client, owner, broken, identity)).status_code == 422
        assert (
            await client.get(f"/api/products/{identity}", headers=owner.headers)
        ).json() == first.json()
