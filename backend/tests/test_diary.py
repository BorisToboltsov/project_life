import uuid
from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import Account, MakeUser
from tests.nutrition import (
    BY_HAND,
    COTTAGE_CHEESE,
    EGG,
    OATMEAL,
    PORTIONS,
    PRESETS,
    TODAY,
    YESTERDAY,
    add_entry,
    add_meal,
    add_product,
    meal_id_of,
    meal_of,
    packages,
    put_entry,
    put_meal,
    put_product,
    read_day,
    servings,
)

pytestmark = pytest.mark.anyio

GOAL = {"kcal": 2100, "protein_g": 130, "fat_g": 70, "carbs_g": 230, "water_ml": 2000}
NO_GOAL = dict.fromkeys(GOAL)
NOTHING = {"kcal": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0}
NO_WATER: dict[str, Any] = {"total_ml": 0, "intakes": []}


async def set_goal(
    client: AsyncClient, account: Account, day: Any = TODAY, **targets: int | None
) -> None:
    response = await client.put(
        "/api/diary/goal",
        headers=account.headers,
        json={**GOAL, **targets, "local_date": str(day)},
    )
    assert response.status_code == 200, response.text


async def read_goal(client: AsyncClient, account: Account) -> dict[str, Any] | None:
    response = await client.get("/api/diary/goal", headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def suggest(
    client: AsyncClient, account: Account, meal: str | None = None
) -> dict[str, list[tuple[str, float]]]:
    """Подсказки: название и количество; `meal` — приём пищи, в который вносят."""
    params = {"meal_id": await meal_id_of(client, account, meal)} if meal else {}
    response = await client.get("/api/diary/suggestions", params=params, headers=account.headers)
    assert response.status_code == 200, response.text
    return {
        kind: [(item["name"], item["amount"]) for item in items]
        for kind, items in response.json().items()
    }


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
        "meal_id": await meal_id_of(client, user, "breakfast"),
        "product_id": product_id,
        "product_name": "Овсяные хлопья",
        "amount": 60,
        "unit": "g",
        "portion": None,
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
    assert [(entry["id"], entry["amount"], entry["kcal"]) for entry in moved] == [
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


async def test_entry_goes_only_into_a_meal_of_its_owner(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    product_id = await add_product(client, user)
    theirs = await meal_id_of(client, other, "breakfast")
    mine = await add_entry(client, user, product_id)

    foreign = await put_entry(client, user, product_id, meal=theirs)
    unknown = await put_entry(client, user, product_id, meal=str(uuid.uuid7()))
    moved = await put_entry(client, user, product_id, meal=theirs, entry_id=mine)

    assert (foreign.status_code, unknown.status_code, moved.status_code) == (404, 404, 404)
    assert foreign.json() == {"detail": "meal_not_found"}
    assert (await read_day(client, other))["totals"]["kcal"] == 0
    assert len(meal_of(await read_day(client, user), "breakfast")["entries"]) == 1


async def test_liquid_is_entered_in_millilitres(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    kefir = await add_product(
        client, user, name="Кефир 1 %", unit="ml", kcal=40, protein_g=3, fat_g=1, carbs_g=4
    )

    response = await put_entry(client, user, kefir, 250)

    # 250 мл от состава на 100 мл.
    entry = response.json()
    assert (entry["amount"], entry["unit"], entry["kcal"], entry["protein_g"]) == (
        250,
        "ml",
        100,
        7.5,
    )


@pytest.mark.parametrize(
    "fields",
    [
        {"amount": 0},
        {"amount": -50},
        {"amount": 5000.1},
        {"amount": 12.34},
        {"amount": None},
        # Количество называют одним способом: в единицах продукта или порциями.
        {"portion": {"kind": "serving", "count": 2}},
        {"amount": None, "portion": {"kind": "serving", "count": 0}},
        {"amount": None, "portion": {"kind": "serving", "count": -1}},
        {"amount": None, "portion": {"kind": "serving", "count": 100.5}},
        {"amount": None, "portion": {"kind": "serving", "count": 1.234}},
        {"amount": None, "portion": {"kind": "slice", "count": 1}},
        {"amount": None, "portion": {"kind": "serving"}},
        {"amount": None, "portion": {"kind": "serving", "count": 1, "size": 60}},
        {"meal_id": "brunch"},
        {"local_date": "1899-12-31"},
        {"local_date": str(TODAY + timedelta(days=400))},
        {"note": "вкусно"},
        # Единица приходит из продукта, а не из запроса.
        {"unit": "ml"},
    ],
)
async def test_implausible_entry_is_rejected(
    client: AsyncClient, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = await make_user()
    body = {
        "local_date": str(TODAY),
        "meal_id": await meal_id_of(client, user, "breakfast"),
        "product_id": await add_product(client, user),
        "amount": 150,
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


# --- Порции ------------------------------------------------------------------------------

TWO_EGGS = {"kind": "serving", "size": 60, "count": 2}


async def test_entry_is_made_in_servings_of_the_product(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    egg = await add_product(client, user, **EGG)

    response = await put_entry(client, user, egg, servings(2))

    assert response.status_code == 201
    entry = response.json()
    # Две порции по 60 г — 120 г от состава на 100 г.
    assert (entry["amount"], entry["unit"], entry["kcal"]) == (120, "g", 188.4)
    assert entry["portion"] == TWO_EGGS
    day = await read_day(client, user)
    assert meal_of(day, "breakfast")["entries"] == [entry]
    assert day["totals"]["kcal"] == 188.4


@pytest.mark.parametrize(
    ("sizes", "portion", "amount"),
    [
        (PORTIONS, servings(1.5), 90),
        (PORTIONS, servings(0.25), 15),
        (PORTIONS, packages(1), 600),
        (PORTIONS, packages(0.5), 300),
        # Количество хранится до десятой: треть упаковки округляется.
        ({"package_size": 200}, packages(0.33), 66),
        ({"serving_size": 33.3}, servings(0.5), 16.7),
        ({"package_size": 5000}, packages(1), 5000),
    ],
)
async def test_amount_is_counted_from_portions(
    client: AsyncClient,
    make_user: MakeUser,
    sizes: dict[str, float],
    portion: dict[str, Any],
    amount: float,
) -> None:
    user = await make_user()
    product_id = await add_product(client, user, **sizes)

    response = await put_entry(client, user, product_id, portion)

    assert response.status_code == 201
    assert response.json()["amount"] == amount
    assert response.json()["portion"]["count"] == portion["count"]


async def test_product_is_not_counted_in_a_portion_it_does_not_have(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    cheese = await add_product(client, user, package_size=200)

    response = await put_entry(client, user, cheese, servings(1))

    assert (response.status_code, response.json()) == (404, {"detail": "portion_not_found"})
    assert meal_of(await read_day(client, user), "breakfast")["entries"] == []


@pytest.mark.parametrize(
    ("sizes", "portion"),
    [
        ({"package_size": 5000}, packages(1.01)),
        ({"serving_size": 600}, servings(100)),
        # Меньше десятой доли единицы продукта — в записи это ноль.
        ({"serving_size": 0.1}, servings(0.25)),
    ],
)
async def test_portions_beyond_a_plausible_amount_are_rejected(
    client: AsyncClient, make_user: MakeUser, sizes: dict[str, float], portion: dict[str, Any]
) -> None:
    user = await make_user()
    product_id = await add_product(client, user, **sizes)

    response = await put_entry(client, user, product_id, portion)

    assert (response.status_code, response.json()) == (400, {"detail": "amount_out_of_range"})
    assert meal_of(await read_day(client, user), "breakfast")["entries"] == []


async def test_entry_goes_from_portions_to_units_and_to_another_portion(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    egg = await add_product(client, user, **EGG)
    entry_id = await add_entry(client, user, egg, servings(2))

    in_grams = await put_entry(client, user, egg, 100, entry_id=entry_id)
    in_packages = await put_entry(client, user, None, packages(1), entry_id=entry_id)

    assert (in_grams.json()["amount"], in_grams.json()["portion"]) == (100, None)
    assert in_packages.json()["amount"] == 600
    assert in_packages.json()["portion"] == {"kind": "package", "size": 600, "count": 1}
    assert len(meal_of(await read_day(client, user), "breakfast")["entries"]) == 1


async def test_entry_of_a_deleted_product_does_not_get_a_new_portion(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    egg = await add_product(client, user, **EGG)
    entry_id = await add_entry(client, user, egg, 100)
    await client.delete(f"/api/products/{egg}", headers=user.headers)

    response = await put_entry(client, user, None, servings(2), entry_id=entry_id)

    # Размер порции взять неоткуда: запись остаётся в единицах продукта.
    assert (response.status_code, response.json()) == (404, {"detail": "portion_not_found"})
    [entry] = meal_of(await read_day(client, user), "breakfast")["entries"]
    assert (entry["amount"], entry["portion"]) == (100, None)


async def test_changing_the_product_takes_the_portion_of_the_new_one(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    egg = await add_product(client, user, **EGG)
    quail = await add_product(client, user, **{**EGG, "name": "Перепелиное", "serving_size": 12})
    entry_id = await add_entry(client, user, egg, servings(2))

    response = await put_entry(client, user, quail, servings(2), entry_id=entry_id)

    assert response.json()["product_name"] == "Перепелиное"
    assert response.json()["amount"] == 24
    assert response.json()["portion"] == {"kind": "serving", "size": 12, "count": 2}


# --- День --------------------------------------------------------------------------------


async def test_empty_day_lists_every_meal(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    day = await read_day(client, user)

    assert day == {
        "local_date": str(TODAY),
        "meals": [
            {
                "id": meal["id"],
                "preset": preset,
                "name": None,
                "archived": False,
                "entries": [],
                "totals": NOTHING,
            }
            for preset, meal in zip(PRESETS, day["meals"], strict=True)
        ],
        "totals": NOTHING,
        "water": NO_WATER,
        "goal": None,
    }
    assert len({meal["id"] for meal in day["meals"]}) == 4


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
            "to_meal_id": await meal_id_of(client, account, to_meal) if to_meal else None,
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
        (entry["product_name"], entry["amount"]) for entry in meal_of(today, "breakfast")["entries"]
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


async def test_copy_goes_only_into_a_meal_of_its_owner(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    source = await add_entry(client, user, await add_product(client, user), day=YESTERDAY)

    status = await copy(client, user, [source], to_meal=await meal_id_of(client, other, "snack"))

    assert status == 404
    assert (await read_day(client, user))["totals"]["kcal"] == 0
    assert (await read_day(client, other))["totals"]["kcal"] == 0


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
    assert meal_of(await read_day(client, owner), "breakfast")["entries"][0]["amount"] == 150
    assert (await read_day(client, stranger))["totals"]["kcal"] == 0


async def test_copy_keys_must_be_client_uuid7(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    source = await add_entry(client, user, await add_product(client, user), day=YESTERDAY)

    status = await copy(client, user, [source], ids=[str(uuid.uuid4())])
    empty = await client.post(
        "/api/diary/copy", headers=user.headers, json={"to_date": str(TODAY), "items": []}
    )

    assert (status, empty.status_code) == (422, 422)


async def test_copy_keeps_the_portions(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    egg = await add_product(client, user, **EGG)
    source = await add_entry(client, user, egg, servings(2), day=YESTERDAY)

    status = await copy(client, user, [source])

    assert status == 204
    [entry] = meal_of(await read_day(client, user), "breakfast")["entries"]
    assert (entry["amount"], entry["portion"]) == (120, TWO_EGGS)


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
    # Недавние — по последнему внесению, с тем количеством, что было в последний раз.
    assert [(item["name"], item["amount"]) for item in suggestions["recent"]] == [
        ("Хлеб", 30),
        ("Творог 5 %", 200),
        ("Овсяные хлопья", 60),
    ]
    # Частые — внесённые не один раз, чаще всего — первыми.
    assert [(item["name"], item["amount"]) for item in suggestions["frequent"]] == [
        ("Творог 5 %", 200),
        ("Овсяные хлопья", 60),
    ]
    # Приём пищи не назван — подсказки по нему пусты.
    assert suggestions["in_meal"] == []
    assert suggestions["recent"][1] == {
        **COTTAGE_CHEESE,
        **BY_HAND,
        "id": cheese,
        "editable": True,
        "amount": 200,
        "portion": None,
    }


async def test_suggestions_start_empty_and_are_limited(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    empty = await client.get("/api/diary/suggestions", headers=user.headers)
    for number in range(12):
        await add_entry(client, user, await add_product(client, user, name=f"Продукт {number}"))
    full = await suggest(client, user, "breakfast")

    assert empty.json() == {"in_meal": [], "recent": [], "frequent": []}
    assert len(full["recent"]) == 10
    assert full["recent"][0][0] == "Продукт 11"
    assert len(full["in_meal"]) == 10


async def test_meal_suggests_what_is_usually_eaten_in_it(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    cheese = await add_product(client, user)
    oatmeal = await add_product(client, user, **OATMEAL)
    bread = await add_product(client, user, name="Хлеб")
    # Завтрак: овсянка дважды, творог и хлеб по разу; творог — позже хлеба.
    await add_entry(client, user, oatmeal, 50, day=YESTERDAY)
    await add_entry(client, user, bread, 30)
    await add_entry(client, user, cheese, 150)
    await add_entry(client, user, oatmeal, 60)
    # Ужин: творог трижды и в другом количестве.
    for amount in (180, 190, 200):
        await add_entry(client, user, cheese, amount, meal="dinner")
    # Чужой завтрак в подсказки не попадает.
    await add_entry(client, other, bread, 500)
    await add_entry(client, other, bread, 500)

    breakfast = await suggest(client, user, "breakfast")
    dinner = await suggest(client, user, "dinner")
    lunch = await suggest(client, user, "lunch")

    # Чаще всего — первыми, при равном счёте — внесённое позже; количество — из этого приёма.
    assert breakfast["in_meal"] == [("Овсяные хлопья", 60), ("Творог 5 %", 150), ("Хлеб", 30)]
    assert dinner["in_meal"] == [("Творог 5 %", 200)]
    assert lunch["in_meal"] == []
    # Общие подсказки от приёма пищи не зависят.
    assert (
        breakfast["frequent"] == dinner["frequent"] == [("Творог 5 %", 200), ("Овсяные хлопья", 60)]
    )
    assert breakfast["recent"] == lunch["recent"]


async def test_meal_suggestions_never_show_another_persons_meal(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    await add_entry(client, owner, await add_product(client, owner))
    theirs = await meal_id_of(client, owner, "breakfast")

    foreign = await suggest(client, stranger, theirs)
    malformed = await client.get(
        "/api/diary/suggestions", params={"meal_id": "breakfast"}, headers=stranger.headers
    )

    assert foreign == {"in_meal": [], "recent": [], "frequent": []}
    assert malformed.status_code == 422


async def how_entered(client: AsyncClient, account: Account, kind: str) -> dict[str, Any]:
    """Подсказки завтрака одного вида: название → количество и порции прошлого раза."""
    response = await client.get(
        "/api/diary/suggestions",
        params={"meal_id": await meal_id_of(client, account, "breakfast")},
        headers=account.headers,
    )
    assert response.status_code == 200, response.text
    return {item["name"]: (item["amount"], item["portion"]) for item in response.json()[kind]}


async def test_suggestion_repeats_the_way_the_product_was_entered(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    egg = await add_product(client, user, **EGG)
    cheese = await add_product(client, user)
    for _ in range(2):
        await add_entry(client, user, cheese, 200)
        await add_entry(client, user, egg, packages(1))
    # В подсказку идёт последний раз: до этого вносили упаковкой.
    await add_entry(client, user, egg, servings(2))

    expected = {"Яйцо куриное": (120, TWO_EGGS), "Творог 5 %": (200, None)}
    for kind in ("in_meal", "recent", "frequent"):
        assert await how_entered(client, user, kind) == expected


async def test_suggested_portion_follows_the_product(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Порция предлагается нынешнего размера; когда её у продукта больше нет, остаётся
    количество в его единицах."""
    user = await make_user()
    egg = await add_product(client, user, **EGG)
    await add_entry(client, user, egg, servings(2))

    await put_product(client, user, {**EGG, "serving_size": 55}, egg)
    resized = await how_entered(client, user, "recent")
    await put_product(client, user, {**EGG, "serving_size": None}, egg)
    removed = await how_entered(client, user, "recent")

    assert resized == {"Яйцо куриное": (120, {**TWO_EGGS, "size": 55})}
    assert removed == {"Яйцо куриное": (120, None)}


# --- Приёмы пищи -------------------------------------------------------------------------


async def test_own_meal_joins_the_end_of_the_day(client: AsyncClient, make_user: MakeUser) -> None:
    user, other = await make_user(), await make_user()
    meal_id = str(uuid.uuid7())

    response = await put_meal(client, user, "  Второй завтрак  ", meal_id)
    await add_meal(client, user, "Полдник")

    assert response.status_code == 201
    assert response.json() == {
        "id": meal_id,
        "preset": None,
        "name": "Второй завтрак",
        "archived": False,
    }
    day = await read_day(client, user)
    assert [meal["preset"] or meal["name"] for meal in day["meals"]] == [
        *PRESETS,
        "Второй завтрак",
        "Полдник",
    ]
    # Список приёмов пищи у каждого свой.
    assert len((await read_day(client, other))["meals"]) == 4


async def test_entries_go_into_an_own_meal(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    meal_id = await add_meal(client, user)

    await add_entry(client, user, await add_product(client, user), 100, meal=meal_id)

    day = await read_day(client, user)
    assert meal_of(day, "Второй завтрак")["totals"]["kcal"] == 121
    assert day["totals"]["kcal"] == 121


async def test_repeated_meal_request_does_not_duplicate_and_renames(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    meal_id = str(uuid.uuid7())

    first = await put_meal(client, user, "Полдник", meal_id)
    again = await put_meal(client, user, "Полдник", meal_id)
    renamed = await put_meal(client, user, "Поздний ужин", meal_id)

    assert (first.status_code, again.status_code, renamed.status_code) == (201, 200, 200)
    names = [meal["name"] for meal in (await read_day(client, user))["meals"]]
    assert names == [None, None, None, None, "Поздний ужин"]


async def test_first_meal_of_an_empty_list_opens_the_day(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    for meal in (await read_day(client, user))["meals"]:
        await client.delete(f"/api/diary/meals/{meal['id']}", headers=user.headers)

    assert (await read_day(client, user))["meals"] == []
    await add_meal(client, user, "Единственный")

    assert [meal["name"] for meal in (await read_day(client, user))["meals"]] == ["Единственный"]


@pytest.mark.parametrize("body", [{"name": ""}, {"name": "   "}, {"name": "я" * 41}, {}])
async def test_meal_needs_a_short_name(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()

    response = await client.put(f"/api/diary/meals/{uuid.uuid7()}", headers=user.headers, json=body)

    assert response.status_code == 422
    assert len((await read_day(client, user))["meals"]) == 4


async def test_preset_meal_can_be_removed(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    snack = await meal_id_of(client, user, "snack")
    path = f"/api/diary/meals/{snack}"

    removed = await client.delete(path, headers=user.headers)
    again = await client.delete(path, headers=user.headers)
    unknown = await client.delete(f"/api/diary/meals/{uuid.uuid7()}", headers=user.headers)

    assert (removed.status_code, again.status_code, unknown.status_code) == (204, 404, 404)
    day = await read_day(client, user)
    assert [meal["preset"] for meal in day["meals"]] == ["breakfast", "lunch", "dinner"]


async def test_removed_meal_stays_in_the_days_it_was_used(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    snack = await meal_id_of(client, user, "snack")
    entry_id = await add_entry(client, user, await add_product(client, user), meal=snack)

    await client.delete(f"/api/diary/meals/{snack}", headers=user.headers)

    today = await read_day(client, user)
    assert meal_of(today, "snack")["archived"] is True
    assert [entry["id"] for entry in meal_of(today, "snack")["entries"]] == [entry_id]
    assert today["totals"]["kcal"] == 181.5
    # В день без записей убранный приём не попадает, а его запись по-прежнему правится.
    assert len((await read_day(client, user, YESTERDAY))["meals"]) == 3
    edited = await put_entry(client, user, None, 100, meal=snack, entry_id=entry_id)
    assert (edited.status_code, edited.json()["kcal"]) == (200, 121)


async def test_removed_meal_returns_with_the_same_request_that_created_it(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    meal_id = await add_meal(client, user, "Полдник")
    await client.delete(f"/api/diary/meals/{meal_id}", headers=user.headers)

    response = await put_meal(client, user, "Полдник", meal_id)

    assert (response.status_code, response.json()["archived"]) == (200, False)
    assert meal_of(await read_day(client, user), "Полдник")["archived"] is False


# --- Цель --------------------------------------------------------------------------------


async def test_goal_is_empty_until_set(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    before = await read_goal(client, user)
    await set_goal(client, user)

    assert before is None
    assert await read_goal(client, user) == {**GOAL, "effective_from": str(TODAY)}


async def test_goal_set_twice_on_one_day_is_replaced(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()

    await set_goal(client, user)
    await set_goal(client, user, kcal=2080)
    await set_goal(client, other, kcal=3000)

    assert (await read_goal(client, user) or {})["kcal"] == 2080
    assert (await read_day(client, user))["goal"] == {
        **GOAL,
        "kcal": 2080,
        "effective_from": str(TODAY),
    }


async def test_past_days_keep_the_goal_they_had(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    await set_goal(client, user, YESTERDAY, kcal=2500)
    await set_goal(client, user, TODAY, kcal=2080)

    before = await read_day(client, user, YESTERDAY - timedelta(days=1))
    yesterday = await read_day(client, user, YESTERDAY)
    today = await read_day(client, user)
    tomorrow = await read_day(client, user, TODAY + timedelta(days=1))

    assert before["goal"] is None
    assert yesterday["goal"]["kcal"] == 2500
    assert today["goal"]["kcal"] == 2080
    assert tomorrow["goal"]["kcal"] == 2080
    assert (await read_goal(client, user) or {})["kcal"] == 2080


@pytest.mark.parametrize(
    "targets",
    [
        {"kcal": 2000, "protein_g": None, "fat_g": None, "carbs_g": None, "water_ml": None},
        {"kcal": None, "protein_g": 150, "fat_g": None, "carbs_g": None, "water_ml": None},
        {"kcal": 2000, "protein_g": 150, "fat_g": None, "carbs_g": None, "water_ml": None},
        {"kcal": None, "protein_g": 130, "fat_g": 70, "carbs_g": 230, "water_ml": None},
        # Белки, жиры и углеводы ровно на все калории: 520 + 630 + 920.
        {"kcal": 2070, "protein_g": 130, "fat_g": 70, "carbs_g": 230, "water_ml": None},
        # Одна вода — тоже цель.
        {"kcal": None, "protein_g": None, "fat_g": None, "carbs_g": None, "water_ml": 2500},
        {"kcal": None, "protein_g": None, "fat_g": None, "carbs_g": None, "water_ml": 100},
        {"kcal": 2000, "protein_g": None, "fat_g": None, "carbs_g": None, "water_ml": 10000},
    ],
)
async def test_goal_takes_any_set_of_targets(
    client: AsyncClient, make_user: MakeUser, targets: dict[str, int | None]
) -> None:
    user = await make_user()

    await set_goal(client, user, **targets)

    assert await read_goal(client, user) == {**targets, "effective_from": str(TODAY)}
    assert (await read_day(client, user))["goal"] == {**targets, "effective_from": str(TODAY)}


async def test_goal_without_any_target_is_no_goal_from_today(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    await set_goal(client, user, YESTERDAY)

    cleared = await client.put(
        "/api/diary/goal", headers=user.headers, json={**NO_GOAL, "local_date": str(TODAY)}
    )

    assert (cleared.status_code, cleared.json()) == (200, None)
    assert await read_goal(client, user) is None
    assert (await read_day(client, user))["goal"] is None
    # Вчерашний день остался со своей целью.
    assert (await read_day(client, user, YESTERDAY))["goal"]["kcal"] == 2100


@pytest.mark.parametrize(
    "fields",
    [
        {"kcal": 499},
        {"kcal": 10001},
        {"kcal": 2100.5},
        {"protein_g": -1},
        {"fat_g": 1001},
        {"carbs_g": 1001},
        # Белки, жиры и углеводы не помещаются в калории: 2070 ккал против 2069.
        {"kcal": 2069},
        {"kcal": 500, "protein_g": 126, "fat_g": None, "carbs_g": None},
        {"water_ml": 99},
        {"water_ml": 10001},
        {"water_ml": 2000.5},
        # Показатель можно оставить пустым, но не пропустить.
        {"kcal": ...},
        # Цель начинается сегодня, а не задним числом и не с будущего.
        {"local_date": str(TODAY - timedelta(days=3))},
        {"local_date": str(TODAY + timedelta(days=3))},
        {"sugars_g": 50},
    ],
)
async def test_implausible_goal_is_rejected(
    client: AsyncClient, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = await make_user()
    body = {**GOAL, "local_date": str(TODAY), **fields}

    response = await client.put(
        "/api/diary/goal",
        headers=user.headers,
        json={name: value for name, value in body.items() if value is not ...},
    )

    assert response.status_code == 422
    assert await read_goal(client, user) is None
