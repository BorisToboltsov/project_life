import uuid
from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import Account, MakeUser
from tests.nutrition import (
    COTTAGE_CHEESE,
    OATMEAL,
    TODAY,
    YESTERDAY,
    add_entry,
    add_product,
    meal_of,
    put_entry,
    read_day,
)

pytestmark = pytest.mark.anyio

GOAL = {"kcal": 2100, "protein_g": 130, "fat_g": 70, "carbs_g": 230}


async def set_goal(client: AsyncClient, account: Account, day: Any = TODAY, **targets: int) -> None:
    response = await client.put(
        "/api/diary/goal",
        headers=account.headers,
        json={**GOAL, **targets, "local_date": str(day)},
    )
    assert response.status_code == 200, response.text


# --- Записи ------------------------------------------------------------------------------


async def test_entry_is_created_with_a_snapshot_of_the_product(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    product_id = await add_product(client, user, **OATMEAL)
    entry_id = str(uuid.uuid7())

    response = await put_entry(client, user, product_id, 60, entry_id=entry_id)

    assert response.status_code == 201
    assert response.json() == {
        "id": entry_id,
        "local_date": str(TODAY),
        "meal": "breakfast",
        "product_id": product_id,
        "product_name": "Овсяные хлопья",
        "amount_g": 60,
        # 60 г от состава на 100 г.
        "kcal": 211.2,
        "protein_g": 7.38,
        "fat_g": 3.72,
        "carbs_g": 37.08,
    }


async def test_repeated_request_does_not_duplicate(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    product_id = await add_product(client, user)
    entry_id = str(uuid.uuid7())

    first = await put_entry(client, user, product_id, entry_id=entry_id)
    again = await put_entry(client, user, product_id, entry_id=entry_id)

    assert (first.status_code, again.status_code) == (201, 200)
    assert len(meal_of(await read_day(client, user), "breakfast")["entries"]) == 1


async def test_entry_changes_amount_meal_and_day(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    product_id = await add_product(client, user)
    entry_id = await add_entry(client, user, product_id, 150)

    response = await put_entry(
        client, user, product_id, 200, meal="dinner", day=YESTERDAY, entry_id=entry_id
    )

    assert response.status_code == 200
    assert (await read_day(client, user))["totals"]["kcal"] == 0
    moved = meal_of(await read_day(client, user, YESTERDAY), "dinner")["entries"]
    assert [(entry["id"], entry["amount_g"], entry["kcal"]) for entry in moved] == [
        (entry_id, 200, 242)
    ]


async def test_changing_the_product_takes_a_new_snapshot(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    cheese = await add_product(client, user)
    oatmeal = await add_product(client, user, **OATMEAL)
    entry_id = await add_entry(client, user, cheese, 100)

    response = await put_entry(client, user, oatmeal, 100, entry_id=entry_id)

    assert (response.json()["product_name"], response.json()["kcal"]) == ("Овсяные хлопья", 352)


async def test_entry_needs_a_product_from_the_catalog(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    unknown = await put_entry(client, user, str(uuid.uuid7()))
    absent = await put_entry(client, user, None)

    assert (unknown.status_code, absent.status_code) == (404, 404)
    assert unknown.json() == {"detail": "product_not_found"}
    assert (await read_day(client, user))["totals"]["kcal"] == 0


@pytest.mark.parametrize(
    "fields",
    [
        {"amount_g": 0},
        {"amount_g": -50},
        {"amount_g": 5000.1},
        {"amount_g": 12.34},
        {"meal": "brunch"},
        {"local_date": "1899-12-31"},
        {"local_date": str(TODAY + timedelta(days=400))},
        {"note": "вкусно"},
    ],
)
async def test_implausible_entry_is_rejected(
    client: AsyncClient, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = await make_user()
    body = {
        "local_date": str(TODAY),
        "meal": "breakfast",
        "product_id": await add_product(client, user),
        "amount_g": 150,
    }

    response = await client.put(
        f"/api/diary/entries/{uuid.uuid7()}", headers=user.headers, json={**body, **fields}
    )

    assert response.status_code == 422


async def test_tomorrow_can_be_planned(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    product_id = await add_product(client, user)

    response = await put_entry(client, user, product_id, day=TODAY + timedelta(days=1))

    assert response.status_code == 201


async def test_entry_is_deleted(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    entry_id = await add_entry(client, user, await add_product(client, user))
    path = f"/api/diary/entries/{entry_id}"

    deleted = await client.delete(path, headers=user.headers)
    again = await client.delete(path, headers=user.headers)

    assert (deleted.status_code, again.status_code) == (204, 404)
    assert (await read_day(client, user))["totals"]["kcal"] == 0


# --- День --------------------------------------------------------------------------------


async def test_empty_day_lists_every_meal(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    nothing = {"kcal": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0}

    day = await read_day(client, user)

    assert day == {
        "local_date": str(TODAY),
        "meals": [
            {"meal": meal, "entries": [], "totals": nothing}
            for meal in ("breakfast", "lunch", "dinner", "snack")
        ],
        "totals": nothing,
        "goal": None,
    }


async def test_day_adds_up_by_meal_and_in_total(client: AsyncClient, make_user: MakeUser) -> None:
    user, other = await make_user(), await make_user()
    cheese = await add_product(client, user)
    oatmeal = await add_product(client, user, **OATMEAL)
    await add_entry(client, user, oatmeal, 60)
    await add_entry(client, user, cheese, 150)
    await add_entry(client, user, cheese, 200, meal="dinner")
    # Не попадают в день: другой день и другой человек.
    await add_entry(client, user, cheese, 500, day=YESTERDAY)
    await add_entry(client, other, cheese, 500)

    day = await read_day(client, user)

    breakfast = meal_of(day, "breakfast")
    assert [entry["product_name"] for entry in breakfast["entries"]] == [
        "Овсяные хлопья",
        "Творог 5 %",
    ]
    assert breakfast["totals"] == {
        "kcal": 392.7,
        "protein_g": 33.18,
        "fat_g": 11.22,
        "carbs_g": 39.78,
    }
    assert meal_of(day, "dinner")["totals"]["kcal"] == 242
    assert meal_of(day, "lunch")["entries"] == []
    assert day["totals"] == {"kcal": 634.7, "protein_g": 67.58, "fat_g": 21.22, "carbs_g": 43.38}


async def test_day_needs_a_plausible_date(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    missing = await client.get("/api/diary", headers=user.headers)
    malformed = await client.get("/api/diary?date=11/10/2026", headers=user.headers)
    ancient = await client.get("/api/diary?date=1812-09-07", headers=user.headers)

    assert (missing.status_code, malformed.status_code, ancient.status_code) == (422, 422, 422)


# --- Копирование -------------------------------------------------------------------------


async def copy(
    client: AsyncClient,
    account: Account,
    source_ids: list[str],
    *,
    to_date: Any = TODAY,
    to_meal: str | None = None,
    ids: list[str] | None = None,
) -> int:
    ids = ids or [str(uuid.uuid7()) for _ in source_ids]
    response = await client.post(
        "/api/diary/copy",
        headers=account.headers,
        json={
            "to_date": str(to_date),
            "to_meal": to_meal,
            "items": [
                {"source_id": source, "id": new}
                for source, new in zip(source_ids, ids, strict=True)
            ],
        },
    )
    return response.status_code


async def test_day_is_copied_keeping_meals_and_order(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    cheese = await add_product(client, user)
    oatmeal = await add_product(client, user, **OATMEAL)
    sources = [
        await add_entry(client, user, oatmeal, 60, day=YESTERDAY),
        await add_entry(client, user, cheese, 150, day=YESTERDAY),
        await add_entry(client, user, cheese, 200, meal="dinner", day=YESTERDAY),
    ]

    status = await copy(client, user, sources)

    assert status == 204
    today, yesterday = await read_day(client, user), await read_day(client, user, YESTERDAY)
    assert today["totals"] == yesterday["totals"]
    assert [
        (entry["product_name"], entry["amount_g"])
        for entry in meal_of(today, "breakfast")["entries"]
    ] == [("Овсяные хлопья", 60), ("Творог 5 %", 150)]
    assert len(meal_of(today, "dinner")["entries"]) == 1
    # Копии — новые записи: исходный день остался при своих.
    assert {entry["id"] for meal in today["meals"] for entry in meal["entries"]}.isdisjoint(sources)


async def test_meal_is_copied_into_another_meal(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    source = await add_entry(client, user, await add_product(client, user), day=YESTERDAY)

    status = await copy(client, user, [source], to_meal="snack")

    assert status == 204
    assert len(meal_of(await read_day(client, user), "snack")["entries"]) == 1


async def test_repeated_copy_does_not_duplicate(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    source = await add_entry(client, user, await add_product(client, user), day=YESTERDAY)
    ids = [str(uuid.uuid7())]

    first = await copy(client, user, [source], ids=ids)
    again = await copy(client, user, [source], ids=ids)

    assert (first, again) == (204, 204)
    assert len(meal_of(await read_day(client, user), "breakfast")["entries"]) == 1


async def test_foreign_entries_cannot_be_copied(client: AsyncClient, make_user: MakeUser) -> None:
    owner, stranger = await make_user(), await make_user()
    product_id = await add_product(client, owner)
    theirs = await add_entry(client, owner, product_id)
    mine = await add_entry(client, stranger, product_id, day=YESTERDAY)

    status = await copy(client, stranger, [mine, theirs])
    missing = await copy(client, stranger, [str(uuid.uuid7())])

    assert (status, missing) == (404, 404)
    assert (await read_day(client, stranger))["totals"]["kcal"] == 0


async def test_copy_cannot_overwrite_an_existing_entry(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    product_id = await add_product(client, owner)
    theirs = await add_entry(client, owner, product_id, 150)
    mine = await add_entry(client, stranger, product_id, 999, day=YESTERDAY)

    # Ключ копии совпал с чужой записью: та остаётся как была.
    status = await copy(client, stranger, [mine], ids=[theirs])

    assert status == 204
    assert meal_of(await read_day(client, owner), "breakfast")["entries"][0]["amount_g"] == 150
    assert (await read_day(client, stranger))["totals"]["kcal"] == 0


async def test_copy_keys_must_be_client_uuid7(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    source = await add_entry(client, user, await add_product(client, user), day=YESTERDAY)

    status = await copy(client, user, [source], ids=[str(uuid.uuid4())])
    empty = await client.post(
        "/api/diary/copy", headers=user.headers, json={"to_date": str(TODAY), "items": []}
    )

    assert (status, empty.status_code) == (422, 422)


# --- Подсказки ---------------------------------------------------------------------------


async def test_suggestions_are_recent_and_frequent_products(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    cheese = await add_product(client, user)
    oatmeal = await add_product(client, user, **OATMEAL)
    bread = await add_product(client, user, name="Хлеб")
    await add_product(client, user, name="Ни разу не ели")
    await add_entry(client, user, cheese, 150)
    await add_entry(client, user, oatmeal, 50)
    await add_entry(client, user, cheese, 180, day=YESTERDAY)
    await add_entry(client, user, oatmeal, 60)
    await add_entry(client, user, cheese, 200)
    await add_entry(client, user, bread, 30)
    # Чужие записи в подсказки не попадают.
    for _ in range(5):
        await add_entry(client, other, bread, 500)

    response = await client.get("/api/diary/suggestions", headers=user.headers)

    assert response.status_code == 200
    suggestions = response.json()
    # Недавние — по последнему внесению, с той граммовкой, что была в последний раз.
    assert [(item["name"], item["amount_g"]) for item in suggestions["recent"]] == [
        ("Хлеб", 30),
        ("Творог 5 %", 200),
        ("Овсяные хлопья", 60),
    ]
    # Частые — внесённые не один раз, чаще всего — первыми.
    assert [(item["name"], item["amount_g"]) for item in suggestions["frequent"]] == [
        ("Творог 5 %", 200),
        ("Овсяные хлопья", 60),
    ]
    assert suggestions["recent"][1] == {
        **COTTAGE_CHEESE,
        "id": cheese,
        "editable": True,
        "amount_g": 200,
    }


async def test_suggestions_start_empty_and_are_limited(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    empty = await client.get("/api/diary/suggestions", headers=user.headers)
    for number in range(12):
        await add_entry(client, user, await add_product(client, user, name=f"Продукт {number}"))
    full = await client.get("/api/diary/suggestions", headers=user.headers)

    assert empty.json() == {"recent": [], "frequent": []}
    assert len(full.json()["recent"]) == 10
    assert full.json()["recent"][0]["name"] == "Продукт 11"


# --- Цель --------------------------------------------------------------------------------


async def test_goal_is_empty_until_set(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    before = await client.get("/api/diary/goal", headers=user.headers)
    await set_goal(client, user)
    after = await client.get("/api/diary/goal", headers=user.headers)

    assert (before.status_code, before.json()) == (200, None)
    assert after.json() == {**GOAL, "effective_from": str(TODAY)}


async def test_goal_set_twice_on_one_day_is_replaced(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()

    await set_goal(client, user)
    await set_goal(client, user, kcal=1800)
    await set_goal(client, other, kcal=3000)

    assert (await client.get("/api/diary/goal", headers=user.headers)).json()["kcal"] == 1800
    assert (await read_day(client, user))["goal"] == {
        **GOAL,
        "kcal": 1800,
        "effective_from": str(TODAY),
    }


async def test_past_days_keep_the_goal_they_had(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    await set_goal(client, user, YESTERDAY, kcal=2500)
    await set_goal(client, user, TODAY, kcal=1800)

    before = await read_day(client, user, YESTERDAY - timedelta(days=1))
    yesterday = await read_day(client, user, YESTERDAY)
    today = await read_day(client, user)
    tomorrow = await read_day(client, user, TODAY + timedelta(days=1))

    assert before["goal"] is None
    assert yesterday["goal"]["kcal"] == 2500
    assert today["goal"]["kcal"] == 1800
    assert tomorrow["goal"]["kcal"] == 1800
    assert (await client.get("/api/diary/goal", headers=user.headers)).json()["kcal"] == 1800


@pytest.mark.parametrize(
    "fields",
    [
        {"kcal": 499},
        {"kcal": 10001},
        {"kcal": 2100.5},
        {"protein_g": -1},
        {"fat_g": 1001},
        {"carbs_g": 1001},
        # Цель начинается сегодня, а не задним числом и не с будущего.
        {"local_date": str(TODAY - timedelta(days=3))},
        {"local_date": str(TODAY + timedelta(days=3))},
        {"water_ml": 2000},
    ],
)
async def test_implausible_goal_is_rejected(
    client: AsyncClient, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = await make_user()

    response = await client.put(
        "/api/diary/goal",
        headers=user.headers,
        json={**GOAL, "local_date": str(TODAY), **fields},
    )

    assert response.status_code == 422
    assert (await client.get("/api/diary/goal", headers=user.headers)).json() is None
