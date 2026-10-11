"""Гейт дневника питания (инвариант I10): прошлые дни не зависят от каталога.

Запись дневника хранит снимок продукта — название и состав на 100 г. Что бы ни случилось
с продуктом позже — правка, удаление, — уже внесённый день показывает то же, что показывал.
"""

from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.nutrition import (
    COTTAGE_CHEESE,
    OATMEAL,
    TODAY,
    YESTERDAY,
    add_entry,
    add_product,
    put_entry,
    put_product,
    read_day,
)

pytestmark = pytest.mark.anyio


async def a_logged_day(client: AsyncClient, make_user: MakeUser) -> tuple[Any, str, str]:
    """Пользователь, продукт каталога и запись с ним во вчерашнем дне."""
    user = await make_user()
    product_id = await add_product(client, user)
    entry_id = await add_entry(client, user, product_id, 150, day=YESTERDAY)
    return user, product_id, entry_id


async def test_editing_a_product_does_not_change_past_days(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, product_id, _ = await a_logged_day(client, make_user)
    before = await read_day(client, user, YESTERDAY)

    edited = await put_product(client, user, {**OATMEAL, "name": "Исправлено"}, product_id)

    assert edited.status_code == 200
    assert await read_day(client, user, YESTERDAY) == before
    assert before["totals"]["kcal"] == 181.5


async def test_deleting_a_product_does_not_change_past_days(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, product_id, _ = await a_logged_day(client, make_user)
    before = await read_day(client, user, YESTERDAY)

    deleted = await client.delete(f"/api/products/{product_id}", headers=user.headers)

    assert deleted.status_code == 204
    after = await read_day(client, user, YESTERDAY)
    [entry] = after["meals"][0]["entries"]
    # Запись на месте, только уже не связана с каталогом.
    assert entry["product_id"] is None
    assert (entry["product_name"], entry["kcal"]) == (COTTAGE_CHEESE["name"], 181.5)
    assert after["totals"] == before["totals"]


async def test_editing_the_amount_keeps_the_snapshot(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, product_id, entry_id = await a_logged_day(client, make_user)
    await put_product(client, user, {**OATMEAL, "name": "Исправлено"}, product_id)

    # Тот же продукт и `null` вместо него оставляют снимок прежним.
    same = await put_entry(client, user, product_id, 200, day=YESTERDAY, entry_id=entry_id)
    kept = await put_entry(client, user, None, 100, day=YESTERDAY, entry_id=entry_id)

    assert (same.json()["product_name"], same.json()["kcal"]) == (COTTAGE_CHEESE["name"], 242)
    assert (kept.json()["product_name"], kept.json()["kcal"]) == (COTTAGE_CHEESE["name"], 121)


async def test_entry_of_a_deleted_product_can_still_be_edited(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, product_id, entry_id = await a_logged_day(client, make_user)
    await client.delete(f"/api/products/{product_id}", headers=user.headers)

    response = await put_entry(client, user, None, 200, day=YESTERDAY, entry_id=entry_id)

    assert response.status_code == 200
    assert (response.json()["product_name"], response.json()["kcal"]) == ("Творог 5 %", 242)


async def test_copy_carries_the_snapshot_not_the_catalog(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, product_id, entry_id = await a_logged_day(client, make_user)
    await put_product(client, user, {**OATMEAL, "name": "Исправлено"}, product_id)

    copied = await client.post(
        "/api/diary/copy",
        headers=user.headers,
        json={
            "to_date": str(TODAY),
            "items": [{"source_id": entry_id, "id": "0199b7a0-0000-7000-8000-00000000c0de"}],
        },
    )

    assert copied.status_code == 204
    today = await read_day(client, user)
    assert today["totals"] == (await read_day(client, user, YESTERDAY))["totals"]
    assert today["meals"][0]["entries"][0]["product_name"] == "Творог 5 %"
