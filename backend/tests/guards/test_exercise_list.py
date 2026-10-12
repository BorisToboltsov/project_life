"""Гейт списка упражнений (инвариант I14): перестройка списка не трогает записанное.

Упражнение убирают из списка, а не удаляют: строка остаётся под тем же ключом и
возвращается вместе со всем, что по ней записано. Что записывает подход — вес и повторы,
повторы, время или кардио — задаётся один раз: смена вида молча превратила бы повторы в
секунды.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.db import session_factory
from app.exercises import ExerciseKind
from app.models import Exercise
from tests.conftest import MakeUser
from tests.exercises import (
    add_exercise,
    add_preset,
    list_exercises,
    put_exercise,
    remove_exercise,
)
from tests.guards.test_isolation import all_routes

pytestmark = pytest.mark.anyio


async def test_removed_preset_returns_under_the_same_key(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    deadlift = (await add_preset(client, user, "deadlift")).json()["id"]

    removed = await remove_exercise(client, user, deadlift)
    returned = await add_preset(client, user, "deadlift")

    assert removed.status_code == 204
    assert returned.json()["id"] == deadlift
    assert returned.json()["archived"] is False


async def test_removed_own_exercise_returns_under_the_same_key(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    row = await add_exercise(client, user, "Тяга гантели к поясу")

    await remove_exercise(client, user, row)
    returned = await put_exercise(client, user, "Тяга гантели к поясу", record_id=row)

    assert returned.json()["id"] == row
    assert returned.json()["archived"] is False


async def test_no_route_deletes_an_exercise(client: AsyncClient, make_user: MakeUser) -> None:
    """Сколько бы раз упражнение ни убирали, его строка остаётся в базе."""
    user = await make_user()
    row = await add_exercise(client, user)
    preset = (await add_preset(client, user, "plank")).json()["id"]

    for _ in range(2):
        await remove_exercise(client, user, row)
        await remove_exercise(client, user, preset)

    async with session_factory() as db:
        assert await db.get(Exercise, uuid.UUID(row)) is not None
        assert await db.get(Exercise, uuid.UUID(preset)) is not None
        assert await db.scalar(select(func.count()).select_from(Exercise)) == 2


@pytest.mark.parametrize("kind", [kind.value for kind in ExerciseKind if kind != "weight_reps"])
async def test_kind_of_an_exercise_cannot_be_changed(
    client: AsyncClient, make_user: MakeUser, kind: str
) -> None:
    user = await make_user()
    row = await add_exercise(client, user, "Тяга гантели к поясу", "weight_reps")

    response = await put_exercise(client, user, "Тяга гантели к поясу", kind, record_id=row)

    assert response.status_code == 422
    listed = (await list_exercises(client, user))["exercises"]
    assert [(exercise["name"], exercise["kind"]) for exercise in listed] == [
        ("Тяга гантели к поясу", "weight_reps")
    ]


async def test_kind_stays_fixed_while_the_exercise_is_out_of_the_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    row = await add_exercise(client, user, "Планка на локтях", "time")
    await remove_exercise(client, user, row)

    response = await put_exercise(client, user, "Планка на локтях", "reps", record_id=row)

    assert response.status_code == 422
    listed = (await list_exercises(client, user))["exercises"]
    assert [(exercise["kind"], exercise["archived"]) for exercise in listed] == [("time", True)]


def test_exercise_routes_are_the_four_the_gate_knows() -> None:
    """Новый маршрут упражнений заставит заглянуть сюда: он не должен уметь удалять."""
    routes = {route for route in all_routes() if "/exercises" in route[1]}

    assert routes == {
        ("GET", "/api/exercises"),
        ("POST", "/api/exercises/presets"),
        ("PUT", "/api/exercises/{exercise_id}"),
        ("DELETE", "/api/exercises/{exercise_id}"),
    }
