"""I17: изменения группы не переписывают состав начатой тренировки."""

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.workout_groups import create_group, start_body

pytestmark = pytest.mark.anyio


async def test_group_changes_leave_started_workout_untouched(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    path, body = await create_group(client, user)
    launch = start_body()
    assert (
        await client.post(path + "/start", headers=user.headers, json=launch)
    ).status_code == 201
    workout_path = "/api/workouts/" + launch["id"]
    before = (await client.get(workout_path, headers=user.headers)).json()
    second = (
        await client.post("/api/exercises/presets", headers=user.headers, json={"preset": "plank"})
    ).json()["id"]
    changed = await client.put(
        path,
        headers=user.headers,
        json={**body, "name": "Другая", "exercise_ids": [second], "dates": []},
    )
    assert changed.status_code == 200
    assert (await client.get(workout_path, headers=user.headers)).json() == before
    await client.delete(path, headers=user.headers)
    assert (await client.get(workout_path, headers=user.headers)).json() == before
    retry = await client.post(path + "/start", headers=user.headers, json=launch)
    assert retry.status_code == 200
    assert retry.json()["id"] == launch["id"]
