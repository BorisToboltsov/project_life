"""I16: завершённая тренировка закрыта, а вид упражнения определяет поля подхода."""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.test_workouts import item, workout

pytestmark = pytest.mark.anyio


async def test_finished_workout_rejects_new_set(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    path = await workout(client, user)
    exercise = await item(client, user, path, "plank")
    finished = await client.post(
        path + "/finish", headers=user.headers, json={"finished_at": datetime.now(UTC).isoformat()}
    )
    assert finished.status_code == 200
    response = await client.put(
        exercise + f"/sets/{uuid.uuid7()}", headers=user.headers, json={"duration_seconds": 30}
    )
    assert response.status_code == 409
    assert (await client.get(path, headers=user.headers)).json()["set_count"] == 0


async def test_other_kind_fields_do_not_enter_history(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    path = await workout(client, user)
    exercise = await item(client, user, path, "plank")
    response = await client.put(
        exercise + f"/sets/{uuid.uuid7()}", headers=user.headers, json={"reps": 30}
    )
    assert response.status_code == 422
    assert (await client.get(path, headers=user.headers)).json()["set_count"] == 0
