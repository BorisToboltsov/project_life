import uuid
from typing import Any

import pytest
from httpx import AsyncClient, Response

from tests.conftest import Account, MakeUser
from tests.nutrition import TODAY, YESTERDAY, read_day

pytestmark = pytest.mark.anyio


async def put_water(
    client: AsyncClient,
    account: Account,
    amount_ml: Any = 250,
    *,
    day: Any = TODAY,
    intake_id: str | None = None,
) -> Response:
    return await client.put(
        f"/api/diary/water/{intake_id or uuid.uuid7()}",
        headers=account.headers,
        json={"local_date": str(day), "amount_ml": amount_ml},
    )


async def drink(client: AsyncClient, account: Account, amount_ml: int = 250, **where: Any) -> str:
    """Вносит порцию воды и возвращает её ключ."""
    response = await put_water(client, account, amount_ml, **where)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def water_of(client: AsyncClient, account: Account, day: Any = TODAY) -> dict[str, Any]:
    return (await read_day(client, account, day))["water"]


# --- Порции ------------------------------------------------------------------------------


async def test_portion_is_created_with_the_client_id(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    intake_id = str(uuid.uuid7())

    response = await put_water(client, user, 250, intake_id=intake_id)

    assert response.status_code == 201
    assert response.json() == {"id": intake_id, "local_date": str(TODAY), "amount_ml": 250}


async def test_day_lists_portions_in_order_and_adds_them_up(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    first = await drink(client, user, 250)
    second = await drink(client, user, 500)
    third = await drink(client, user, 150)

    assert await water_of(client, user) == {
        "total_ml": 900,
        "intakes": [
            {"id": first, "local_date": str(TODAY), "amount_ml": 250},
            {"id": second, "local_date": str(TODAY), "amount_ml": 500},
            {"id": third, "local_date": str(TODAY), "amount_ml": 150},
        ],
    }


async def test_water_belongs_to_its_day_and_its_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()

    await drink(client, user, 250)
    await drink(client, user, 500, day=YESTERDAY)
    await drink(client, other, 1000)

    assert (await water_of(client, user))["total_ml"] == 250
    assert (await water_of(client, user, YESTERDAY))["total_ml"] == 500
    assert (await water_of(client, other))["total_ml"] == 1000


async def test_repeated_request_does_not_add_a_second_portion(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    intake_id = str(uuid.uuid7())

    first = await put_water(client, user, 250, intake_id=intake_id)
    again = await put_water(client, user, 250, intake_id=intake_id)

    assert (first.status_code, again.status_code) == (201, 200)
    assert await water_of(client, user) == {
        "total_ml": 250,
        "intakes": [{"id": intake_id, "local_date": str(TODAY), "amount_ml": 250}],
    }


async def test_saving_under_the_same_id_replaces_the_portion(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    intake_id = await drink(client, user, 250)

    response = await put_water(client, user, 330, day=YESTERDAY, intake_id=intake_id)

    assert response.status_code == 200
    assert response.json() == {"id": intake_id, "local_date": str(YESTERDAY), "amount_ml": 330}
    assert (await water_of(client, user))["total_ml"] == 0
    assert (await water_of(client, user, YESTERDAY))["total_ml"] == 330


@pytest.mark.parametrize("amount_ml", [1, 5000])
async def test_portion_can_be_a_sip_or_a_big_bottle(
    client: AsyncClient, make_user: MakeUser, amount_ml: int
) -> None:
    user = await make_user()

    await drink(client, user, amount_ml)

    assert (await water_of(client, user))["total_ml"] == amount_ml


@pytest.mark.parametrize(
    "body",
    [
        {"amount_ml": 0},
        {"amount_ml": -250},
        {"amount_ml": 5001},
        {"amount_ml": 250.5},
        {"amount_ml": None},
        {"amount_ml": ...},
        {"local_date": "1899-12-31"},
        {"local_date": ...},
        {"unit": "ml"},
    ],
)
async def test_implausible_portion_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()
    payload = {"local_date": str(TODAY), "amount_ml": 250, **body}

    response = await client.put(
        f"/api/diary/water/{uuid.uuid7()}",
        headers=user.headers,
        json={name: value for name, value in payload.items() if value is not ...},
    )

    assert response.status_code == 422
    assert (await water_of(client, user))["total_ml"] == 0


async def test_record_id_must_be_a_version_7_uuid(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    response = await put_water(client, user, intake_id=str(uuid.uuid4()))

    assert response.status_code == 422


def lose_the_first_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Имитирует гонку: первая проверка «есть ли порция» отвечает «нет», хотя она уже создана."""
    from app.api import diary

    real = diary._own_intake  # pyright: ignore[reportPrivateUsage]
    calls = 0

    async def racing(*args: Any) -> Any:
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real(*args)

    monkeypatch.setattr(diary, "_own_intake", racing)


async def test_parallel_creation_with_one_id_ends_as_a_replace(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    intake_id = await drink(client, user, 250)
    lose_the_first_lookup(monkeypatch)

    response = await put_water(client, user, 500, intake_id=intake_id)

    assert response.status_code == 200
    assert (await water_of(client, user))["total_ml"] == 500


async def test_parallel_creation_cannot_take_over_a_foreign_id(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, stranger = await make_user(), await make_user()
    intake_id = await drink(client, owner, 250)
    lose_the_first_lookup(monkeypatch)

    response = await put_water(client, stranger, 5000, intake_id=intake_id)

    assert response.status_code == 404
    assert (await water_of(client, owner))["total_ml"] == 250
    assert (await water_of(client, stranger))["total_ml"] == 0


# --- Удаление ----------------------------------------------------------------------------


async def test_portion_can_be_removed(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    kept = await drink(client, user, 250)
    mistaken = await drink(client, user, 500)

    removed = await client.delete(f"/api/diary/water/{mistaken}", headers=user.headers)
    again = await client.delete(f"/api/diary/water/{mistaken}", headers=user.headers)

    assert (removed.status_code, again.status_code) == (204, 404)
    assert again.json() == {"detail": "not_found"}
    assert await water_of(client, user) == {
        "total_ml": 250,
        "intakes": [{"id": kept, "local_date": str(TODAY), "amount_ml": 250}],
    }


async def test_users_do_not_touch_each_others_water(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    intake_id = await drink(client, owner, 250)

    replaced = await put_water(client, stranger, 5000, intake_id=intake_id)
    removed = await client.delete(f"/api/diary/water/{intake_id}", headers=stranger.headers)

    assert (replaced.status_code, removed.status_code) == (404, 404)
    assert (await water_of(client, owner))["total_ml"] == 250


async def test_deleting_the_user_deletes_their_water(
    client: AsyncClient, make_user: MakeUser
) -> None:
    from sqlalchemy import func, select

    from app.db import session_factory
    from app.models import User, WaterIntake

    user = await make_user()
    await drink(client, user)

    async with session_factory() as db:
        await db.delete(await db.get_one(User, user.id))
        await db.commit()
        remaining = await db.scalar(select(func.count()).select_from(WaterIntake))

    assert remaining == 0


# --- Цель --------------------------------------------------------------------------------


async def test_day_carries_the_water_goal_it_had(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    no_food_goal = {"kcal": None, "protein_g": None, "fat_g": None, "carbs_g": None}
    for day, water_ml in ((YESTERDAY, 2000), (TODAY, 2500)):
        response = await client.put(
            "/api/diary/goal",
            headers=user.headers,
            json={**no_food_goal, "water_ml": water_ml, "local_date": str(day)},
        )
        assert response.status_code == 200, response.text

    yesterday = await read_day(client, user, YESTERDAY)
    today = await read_day(client, user)

    assert yesterday["goal"] == {**no_food_goal, "water_ml": 2000, "effective_from": str(YESTERDAY)}
    assert today["goal"] == {**no_food_goal, "water_ml": 2500, "effective_from": str(TODAY)}


FOOD_GOAL = {"kcal": 2100, "protein_g": 130, "fat_g": 70, "carbs_g": 230}


async def test_previous_app_version_keeps_the_water_goal(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Приложение, которое ещё не обновили, сохраняет цель без поля воды — вода остаётся."""
    user = await make_user()
    await client.put(
        "/api/diary/goal",
        headers=user.headers,
        json={**FOOD_GOAL, "water_ml": 2500, "local_date": str(YESTERDAY)},
    )

    for kcal in (2200, 2300):
        saved = await client.put(
            "/api/diary/goal",
            headers=user.headers,
            json={**FOOD_GOAL, "kcal": kcal, "local_date": str(TODAY)},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json() == {
            **FOOD_GOAL,
            "kcal": kcal,
            "water_ml": 2500,
            "effective_from": str(TODAY),
        }

    assert (await read_day(client, user))["goal"]["water_ml"] == 2500


async def test_previous_app_version_does_not_invent_a_water_goal(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    saved = await client.put(
        "/api/diary/goal", headers=user.headers, json={**FOOD_GOAL, "local_date": str(TODAY)}
    )

    assert saved.json() == {**FOOD_GOAL, "water_ml": None, "effective_from": str(TODAY)}


async def test_water_goal_is_removed_only_by_an_explicit_null(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    for water_ml in (2500, None):
        await client.put(
            "/api/diary/goal",
            headers=user.headers,
            json={**FOOD_GOAL, "water_ml": water_ml, "local_date": str(TODAY)},
        )

    assert (await read_day(client, user))["goal"]["water_ml"] is None
