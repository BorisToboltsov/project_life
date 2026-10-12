"""Список упражнений пользователя: штатные из справочника и свои."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import MakeUser
from tests.exercises import (
    add_exercise,
    add_preset,
    list_exercises,
    names,
    put_exercise,
    remove_exercise,
)
from tests.test_auth import issue_invite, registration

pytestmark = pytest.mark.anyio


# --- Список и справочник ----------------------------------------------------------------


async def test_new_user_starts_with_an_empty_list_and_the_whole_catalog(
    client: AsyncClient, db: AsyncSession
) -> None:
    session = await client.post("/api/auth/register", json=registration(await issue_invite(db)))
    headers = {"Authorization": f"Bearer {session.json()['access_token']}"}

    listing = (await client.get("/api/exercises", headers=headers)).json()

    assert listing["exercises"] == []
    assert len(listing["catalog"]) == 40
    assert listing["catalog"][0] == {
        "preset": "elliptical",
        "kind": "cardio",
        "muscles": ["quads", "glutes"],
        "secondary": ["hamstrings", "calves"],
        "cardio_fields": ["distance", "level"],
    }


async def test_catalog_stays_whole_when_exercises_are_added(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    await add_preset(client, account, "deadlift")

    listing = await list_exercises(client, account)

    assert len(listing["catalog"]) == 40
    assert "deadlift" in [exercise["preset"] for exercise in listing["catalog"]]


async def test_list_describes_kind_muscles_and_cardio_fields(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    await add_preset(client, account, "deadlift")
    await add_preset(client, account, "treadmill_walk")
    await add_exercise(client, account, "Тяга гантели к поясу", muscles=["lats", "biceps"])
    await add_exercise(client, account, "Лыжный тренажёр", "cardio")

    listing = await list_exercises(client, account)

    described = [
        {key: value for key, value in exercise.items() if key != "id"}
        for exercise in listing["exercises"]
    ]
    assert described == [
        {
            "preset": "deadlift",
            "name": None,
            "kind": "weight_reps",
            "muscles": ["hamstrings", "glutes", "lower_back"],
            "secondary": ["quads", "traps"],
            "cardio_fields": [],
            "archived": False,
        },
        {
            "preset": "treadmill_walk",
            "name": None,
            "kind": "cardio",
            "muscles": ["quads", "glutes"],
            "secondary": ["calves"],
            "cardio_fields": ["distance", "incline"],
            "archived": False,
        },
        {
            "preset": None,
            "name": "Тяга гантели к поясу",
            "kind": "weight_reps",
            "muscles": ["lats", "biceps"],
            "secondary": [],
            "cardio_fields": [],
            "archived": False,
        },
        {
            "preset": None,
            "name": "Лыжный тренажёр",
            "kind": "cardio",
            "muscles": [],
            "secondary": [],
            "cardio_fields": ["distance", "incline", "level"],
            "archived": False,
        },
    ]


# --- Штатные упражнения -----------------------------------------------------------------


async def test_preset_is_added_to_the_end_of_the_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    await add_preset(client, account, "plank")

    response = await add_preset(client, account, "pull_up")

    assert response.status_code == 200
    assert response.json()["preset"] == "pull_up"
    assert response.json()["kind"] == "reps"
    assert uuid.UUID(response.json()["id"]).version == 7
    assert names(await list_exercises(client, account)) == ["plank", "pull_up"]


async def test_adding_a_preset_twice_keeps_one(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    first = await add_preset(client, account, "leg_press")
    again = await add_preset(client, account, "leg_press")

    assert first.json() == again.json()
    assert names(await list_exercises(client, account)) == ["leg_press"]


async def test_unknown_preset_is_rejected(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    response = await add_preset(client, account, "handstand")

    assert response.status_code == 422
    assert names(await list_exercises(client, account)) == []


async def test_lists_of_two_users_do_not_mix(client: AsyncClient, make_user: MakeUser) -> None:
    first, second = await make_user(), await make_user()
    mine = (await add_preset(client, first, "plank")).json()["id"]

    theirs = (await add_preset(client, second, "plank")).json()["id"]

    assert mine != theirs
    assert names(await list_exercises(client, first)) == ["plank"]
    assert names(await list_exercises(client, second)) == ["plank"]


# --- Свои упражнения --------------------------------------------------------------------


async def test_own_exercise_is_created_with_a_client_key(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())

    response = await put_exercise(
        client, account, "  Тяга гантели к поясу ", muscles=["lats"], record_id=record_id
    )

    assert response.status_code == 201
    assert response.json() == {
        "id": record_id,
        "preset": None,
        "name": "Тяга гантели к поясу",
        "kind": "weight_reps",
        "muscles": ["lats"],
        "secondary": [],
        "cardio_fields": [],
        "archived": False,
    }


async def test_repeated_request_does_not_duplicate_an_own_exercise(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())

    first = await put_exercise(client, account, record_id=record_id)
    again = await put_exercise(client, account, record_id=record_id)

    assert (first.status_code, again.status_code) == (201, 200)
    assert names(await list_exercises(client, account)) == ["Тяга гантели к поясу"]


async def test_own_exercise_gets_a_new_name_and_muscles(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    row = await add_exercise(client, account, "Тяга", muscles=["lats"])

    response = await put_exercise(
        client, account, "Тяга гантели", muscles=["lats", "biceps"], record_id=row
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Тяга гантели"
    assert response.json()["muscles"] == ["lats", "biceps"]


async def test_muscle_named_twice_is_kept_once(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    response = await put_exercise(client, account, muscles=["lats", "biceps", "lats"])

    assert response.json()["muscles"] == ["lats", "biceps"]


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "kind": "weight_reps"},
        {"name": "   ", "kind": "weight_reps"},
        {"name": "я" * 61, "kind": "weight_reps"},
        {"name": "Тяга", "kind": "distance"},
        {"name": "Тяга"},
        {"name": "Тяга", "kind": "reps", "muscles": ["heart"]},
        {"name": "Тяга", "kind": "reps", "preset": "plank"},
    ],
)
async def test_malformed_own_exercise_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, object]
) -> None:
    account = await make_user()

    response = await client.put(
        f"/api/exercises/{uuid.uuid7()}", headers=account.headers, json=body
    )

    assert response.status_code == 422
    assert names(await list_exercises(client, account)) == []


async def test_preset_cannot_be_renamed(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    plank = (await add_preset(client, account, "plank")).json()["id"]

    response = await put_exercise(client, account, "Моя планка", "time", record_id=plank)

    assert response.status_code == 404
    assert names(await list_exercises(client, account)) == ["plank"]


# --- Убрать из списка -------------------------------------------------------------------


async def test_removed_preset_leaves_the_list_and_returns_to_its_place(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    plank = (await add_preset(client, account, "plank")).json()["id"]
    await add_preset(client, account, "pull_up")

    removed = await remove_exercise(client, account, plank)
    listing = await list_exercises(client, account)
    returned = await add_preset(client, account, "plank")

    assert removed.status_code == 204
    assert names(listing) == ["pull_up"]
    assert names(listing, archived=True) == ["plank"]
    assert returned.json()["id"] == plank
    assert names(await list_exercises(client, account)) == ["plank", "pull_up"]


async def test_removed_own_exercise_returns_by_its_key(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    row = await add_exercise(client, account, "Тяга", muscles=["lats"])

    await remove_exercise(client, account, row)
    removed = names(await list_exercises(client, account), archived=True)
    returned = await put_exercise(client, account, "Тяга", muscles=["lats"], record_id=row)

    assert removed == ["Тяга"]
    assert returned.status_code == 200
    assert returned.json()["archived"] is False


async def test_removing_twice_or_a_missing_exercise_is_not_found(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    row = await add_exercise(client, account)
    await remove_exercise(client, account, row)

    again = await remove_exercise(client, account, row)
    missing = await remove_exercise(client, account, str(uuid.uuid7()))

    assert (again.status_code, missing.status_code) == (404, 404)
