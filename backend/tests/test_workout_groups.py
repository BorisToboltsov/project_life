import uuid
from datetime import date
from typing import Any

import pytest
from httpx import AsyncClient

from app.models import WorkoutGroup
from tests.conftest import MakeUser
from tests.workout_groups import create_group, start_body

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("day", "expected"),
    [
        ("2026-10-15", False),
        ("2026-10-18", True),
        ("2026-10-19", True),
        ("2026-10-20", False),
        ("2026-10-22", True),
        ("2026-11-02", False),
        ("2026-11-05", True),
    ],
)
def test_schedule_combines_bounded_weekdays_and_extra_dates(day: str, expected: bool) -> None:
    group = WorkoutGroup(
        weekdays=[0, 3],
        start_date=date(2026, 10, 19),
        end_date=date(2026, 11, 1),
        dates=[date(2026, 10, 18), date(2026, 11, 5)],
    )
    assert group.scheduled_on(date.fromisoformat(day)) is expected


async def test_group_save_list_edit_and_archive(client: AsyncClient, make_user: MakeUser) -> None:
    user, other = await make_user(), await make_user()
    path, body = await create_group(client, user)
    saved = await client.put(path, headers=user.headers, json=body)
    assert saved.status_code == 200
    listed = (await client.get("/api/workout-groups?day=2026-10-19", headers=user.headers)).json()
    assert len(listed["groups"]) == 1
    assert listed["groups"][0]["scheduled"] is True
    assert (await client.get("/api/workout-groups", headers=other.headers)).json()["groups"] == []
    changed = await client.put(
        path,
        headers=user.headers,
        json={**body, "name": "Новая группа", "weekdays": [], "dates": []},
    )
    assert changed.json()["name"] == "Новая группа"
    assert (await client.delete(path, headers=user.headers)).status_code == 204
    assert (await client.get("/api/workout-groups", headers=user.headers)).json()["groups"] == []
    assert (
        await client.post(path + "/start", headers=user.headers, json=start_body())
    ).status_code == 404
    assert (await client.put(path, headers=user.headers, json=body)).status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        {"name": "  "},
        {"exercise_ids": []},
        {"weekdays": [7]},
        {"weekdays": [0, 0]},
        {"start_date": None},
        {"end_date": "2026-10-01"},
        {"dates": ["2026-10-18", "2026-10-18"]},
    ],
)
async def test_invalid_schedule_rejected(
    client: AsyncClient, make_user: MakeUser, change: dict[str, Any]
) -> None:
    user = await make_user()
    path, body = await create_group(client, user)
    assert (
        await client.put(path, headers=user.headers, json={**body, **change})
    ).status_code == 422


async def test_foreign_archived_and_duplicate_exercises_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    path, body = await create_group(client, user)
    foreign_path = f"/api/workout-groups/{uuid.uuid7()}"
    assert (await client.put(foreign_path, headers=other.headers, json=body)).status_code == 409
    duplicate = {**body, "exercise_ids": body["exercise_ids"] * 2}
    assert (await client.put(path, headers=user.headers, json=duplicate)).status_code == 422
    await client.delete("/api/exercises/" + body["exercise_ids"][0], headers=user.headers)
    assert (
        await client.post(path + "/start", headers=user.headers, json=start_body())
    ).status_code == 409
    assert (await client.put(path, headers=user.headers, json=body)).status_code == 409


async def test_launch_order_retry_and_active_conflict(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    path, body = await create_group(client, user)
    second = (
        await client.post("/api/exercises/presets", headers=user.headers, json={"preset": "plank"})
    ).json()["id"]
    body["exercise_ids"].insert(0, second)
    await client.put(path, headers=user.headers, json=body)
    launch = start_body(2)
    result = await client.post(path + "/start", headers=user.headers, json=launch)
    assert result.status_code == 201, result.text
    assert (
        await client.post(path + "/start", headers=user.headers, json=launch)
    ).status_code == 200
    detail = (await client.get("/api/workouts/" + launch["id"], headers=user.headers)).json()
    assert [item["exercise"]["id"] for item in detail["exercises"]] == body["exercise_ids"]
    assert detail["set_count"] == 0
    conflict = await client.post(path + "/start", headers=user.headers, json=start_body(2))
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "workout_active"


async def test_launch_rejects_bad_keys_and_foreign_workout(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    path, _ = await create_group(client, user)
    foreign_path, _ = await create_group(client, other)
    launch = start_body()
    await client.post(foreign_path + "/start", headers=other.headers, json=launch)
    assert (
        await client.post(path + "/start", headers=user.headers, json=launch)
    ).status_code == 404
    assert (
        await client.post(path + "/start", headers=user.headers, json=start_body(0))
    ).status_code == 409
    bad = {**start_body(), "id": str(uuid.uuid4())}
    assert (await client.post(path + "/start", headers=user.headers, json=bad)).status_code == 422
