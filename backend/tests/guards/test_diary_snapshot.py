"""Гейт дневника питания (инвариант I10): прошлые дни не зависят от каталога и от списка
приёмов пищи.

Запись дневника хранит снимок продукта — название, единицу и состав на 100 единиц. Что бы
ни случилось с продуктом позже — правка, удаление, — уже внесённый день показывает то же,
что показывал. Приём пищи, убранный из списка, остаётся в днях, где в нём есть записи.
"""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodEntry
from tests.conftest import MakeUser
from tests.nutrition import (
    COTTAGE_CHEESE,
    LABEL,
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

    edited = await put_product(
        client, user, {**OATMEAL, "name": "Исправлено", "unit": "ml"}, product_id
    )

    assert edited.status_code == 200
    assert await read_day(client, user, YESTERDAY) == before
    assert before["totals"]["kcal"] == 181.5
    assert before["meals"][0]["entries"][0]["unit"] == "g"


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
    await put_product(client, user, {**OATMEAL, "name": "Исправлено", "unit": "ml"}, product_id)

    # Тот же продукт и `null` вместо него оставляют снимок прежним.
    same = await put_entry(client, user, product_id, 200, day=YESTERDAY, entry_id=entry_id)
    kept = await put_entry(client, user, None, 100, day=YESTERDAY, entry_id=entry_id)

    assert (same.json()["product_name"], same.json()["kcal"]) == (COTTAGE_CHEESE["name"], 242)
    assert (kept.json()["product_name"], kept.json()["kcal"]) == (COTTAGE_CHEESE["name"], 121)
    assert (same.json()["unit"], kept.json()["unit"]) == ("g", "g")


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
    await put_product(client, user, {**OATMEAL, "name": "Исправлено", "unit": "ml"}, product_id)

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
    [copy] = today["meals"][0]["entries"]
    assert (copy["product_name"], copy["unit"]) == ("Творог 5 %", "g")


async def test_snapshot_keeps_the_whole_label(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    """Что ещё печатают на этикетке, в итоги дня не входит, но снимается в запись так же,
    как калории: когда итоги появятся, прошлые дни не придётся достраивать по каталогу."""
    user = await make_user()
    product_id = await add_product(client, user, **LABEL)
    entry_id = await add_entry(client, user, product_id, 150, day=YESTERDAY)
    copy_id = "0199b7a0-0000-7000-8000-00000000c0de"

    # Продукт исправили и убрали этикетку — запись и её копия держат прежнее.
    await put_product(client, user, {**OATMEAL, "sugars_g": 1}, product_id)
    await put_entry(client, user, product_id, 200, day=YESTERDAY, entry_id=entry_id)
    copied = await client.post(
        "/api/diary/copy",
        headers=user.headers,
        json={"to_date": str(TODAY), "items": [{"source_id": entry_id, "id": copy_id}]},
    )

    assert copied.status_code == 204
    entries = list(await db.scalars(select(FoodEntry).order_by(FoodEntry.local_date)))
    assert [str(entry.id) for entry in entries] == [entry_id, copy_id]
    for entry in entries:
        assert {name: float(getattr(entry, name)) for name in LABEL} == LABEL


async def test_removing_a_meal_does_not_change_past_days(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, _, _ = await a_logged_day(client, make_user)
    before = await read_day(client, user, YESTERDAY)
    breakfast = before["meals"][0]

    removed = await client.delete(f"/api/diary/meals/{breakfast['id']}", headers=user.headers)

    assert removed.status_code == 204
    after = await read_day(client, user, YESTERDAY)
    # Приём на месте со всеми записями — отмечен только тем, что убран из списка.
    assert after == {**before, "meals": [{**breakfast, "archived": True}, *before["meals"][1:]]}
    assert after["totals"]["kcal"] == 181.5
    # А в день, где в нём ничего нет, он больше не попадает.
    assert breakfast["id"] not in {meal["id"] for meal in (await read_day(client, user))["meals"]}
