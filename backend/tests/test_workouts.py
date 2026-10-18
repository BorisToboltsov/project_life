"""Журнал тренировок и подходов всех четырёх видов."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from tests.conftest import Account, MakeUser

pytestmark = pytest.mark.anyio


def moment(days: int = 0) -> dict[str, str]:
    started = datetime.now(UTC) + timedelta(days=days)
    return {"started_at": started.isoformat(), "local_date": started.date().isoformat()}


async def workout(client: AsyncClient, user: Account, days: int = 0) -> str:
    path = f"/api/workouts/{uuid.uuid7()}"
    result = await client.put(path, headers=user.headers, json=moment(days))
    assert result.status_code == 201, result.text
    return path


async def item(client: AsyncClient, user: Account, workout_path: str, preset: str) -> str:
    exercise = await client.post(
        "/api/exercises/presets", headers=user.headers, json={"preset": preset}
    )
    assert exercise.status_code == 200
    path = workout_path + f"/exercises/{uuid.uuid7()}"
    added = await client.put(
        path, headers=user.headers, json={"exercise_id": exercise.json()["id"]}
    )
    assert added.status_code == 201, added.text
    return path


async def test_active_workout_date_history_and_finish(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    first = await workout(client, user)
    again = await client.put(first, headers=user.headers, json=moment())
    second = await client.put(f"/api/workouts/{uuid.uuid7()}", headers=user.headers, json=moment())
    assert again.status_code == 200
    assert second.status_code == 409
    assert second.json() == {"detail": "workout_active"}

    finished = await client.post(
        first + "/finish",
        headers=user.headers,
        json={"finished_at": datetime.now(UTC).isoformat()},
    )
    assert finished.status_code == 200
    assert finished.json()["finished_at"] is not None
    await workout(client, user)
    listing = (await client.get("/api/workouts", headers=user.headers)).json()["workouts"]
    assert len(listing) == 2
    assert [row["finished_at"] is None for row in listing] == [True, False]


@pytest.mark.parametrize(
    ("preset", "body", "canonical"),
    [
        ("deadlift", {"weight_value": 100, "weight_unit": "lb", "reps": 8}, "weight_kg"),
        ("pull_up", {"reps": 6}, "reps"),
        ("plank", {"duration_seconds": 45}, "duration_seconds"),
        (
            "treadmill_walk",
            {
                "duration_seconds": 600,
                "distance_value": 1,
                "distance_unit": "mi",
                "incline_percent": 5,
            },
            "distance_km",
        ),
    ],
)
async def test_set_kind_and_units(
    client: AsyncClient,
    make_user: MakeUser,
    preset: str,
    body: dict[str, object],
    canonical: str,
) -> None:
    user = await make_user()
    path = await item(client, user, await workout(client, user), preset)
    set_path = path + f"/sets/{uuid.uuid7()}"
    saved = await client.put(set_path, headers=user.headers, json=body)
    repeated = await client.put(set_path, headers=user.headers, json=body)
    assert saved.status_code == 201, saved.text
    assert repeated.status_code == 200
    assert saved.json() == repeated.json()
    assert saved.json()[canonical] is not None
    if preset == "deadlift":
        assert saved.json()["weight_kg"] == 45.359
    if preset == "treadmill_walk":
        assert saved.json()["distance_km"] == 1.609
    detail = (await client.get(path.split("/exercises/")[0], headers=user.headers)).json()
    assert detail["set_count"] == 1


async def test_wrong_fields_and_archived_exercise_reject_new_sets(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    path = await item(client, user, await workout(client, user), "plank")
    wrong = await client.put(
        path + f"/sets/{uuid.uuid7()}", headers=user.headers, json={"reps": 10}
    )
    assert wrong.status_code == 422
    exercise = (await client.get("/api/exercises", headers=user.headers)).json()["exercises"][0]
    removed = await client.delete(f"/api/exercises/{exercise['id']}", headers=user.headers)
    assert removed.status_code == 204
    blocked = await client.put(
        path + f"/sets/{uuid.uuid7()}", headers=user.headers, json={"duration_seconds": 40}
    )
    assert blocked.status_code == 404
    detail = (await client.get(path.split("/exercises/")[0], headers=user.headers)).json()
    assert detail["exercises"][0]["exercise"]["archived"] is True


async def test_previous_sets_and_rest_setting_survive_list_changes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    first = await workout(client, user, -1)
    first_item = await item(client, user, first, "deadlift")
    saved = await client.put(
        first_item + f"/sets/{uuid.uuid7()}",
        headers=user.headers,
        json={"weight_value": 60, "weight_unit": "kg", "reps": 5},
    )
    assert saved.status_code == 201
    await client.post(
        first + "/finish",
        headers=user.headers,
        json={"finished_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat()},
    )
    second = await workout(client, user)
    await item(client, user, second, "deadlift")
    detail = (await client.get(second, headers=user.headers)).json()
    assert detail["exercises"][0]["previous"][0]["reps"] == 5
    exercise_id = detail["exercises"][0]["exercise"]["id"]
    rest = await client.put(
        f"/api/exercises/{exercise_id}/rest", headers=user.headers, json={"rest_seconds": 45}
    )
    assert rest.status_code == 200
    assert rest.json()["rest_seconds"] == 45


async def test_foreign_exercise_cannot_be_added(client: AsyncClient, make_user: MakeUser) -> None:
    owner, other = await make_user(), await make_user()
    exercise = await client.post(
        "/api/exercises/presets", headers=owner.headers, json={"preset": "plank"}
    )
    path = await workout(client, other)
    response = await client.put(
        path + f"/exercises/{uuid.uuid7()}",
        headers=other.headers,
        json={"exercise_id": exercise.json()["id"]},
    )
    assert response.status_code == 404
    assert (await client.get(path, headers=other.headers)).json()["exercise_count"] == 0


async def test_repeat_copies_exercises_without_sets_and_is_idempotent(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    source = await workout(client, user, -1)
    exercise = await item(client, user, source, "deadlift")
    await client.put(
        exercise + f"/sets/{uuid.uuid7()}",
        headers=user.headers,
        json={"weight_value": 70, "weight_unit": "kg", "reps": 5},
    )
    await client.post(
        source + "/finish",
        headers=user.headers,
        json={"finished_at": datetime.now(UTC).isoformat()},
    )
    body = {"id": str(uuid.uuid7()), "item_ids": [str(uuid.uuid7())], **moment()}
    repeated = await client.post(source + "/repeat", headers=user.headers, json=body)
    again = await client.post(source + "/repeat", headers=user.headers, json=body)
    assert repeated.status_code == 201, repeated.text
    assert again.status_code == 200
    assert repeated.json() == again.json()
    detail = (await client.get(f"/api/workouts/{body['id']}", headers=user.headers)).json()
    assert detail["exercise_count"] == 1
    assert detail["set_count"] == 0
    assert detail["exercises"][0]["exercise"]["preset"] == "deadlift"


async def test_progress_is_computed_from_finished_sets(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    first = await workout(client, user, -1)
    exercise = await item(client, user, first, "deadlift")
    saved = await client.put(
        exercise + f"/sets/{uuid.uuid7()}",
        headers=user.headers,
        json={"weight_value": 80, "weight_unit": "kg", "reps": 6},
    )
    assert saved.status_code == 201
    exercise_id = (await client.get(first, headers=user.headers)).json()["exercises"][0][
        "exercise"
    ]["id"]
    progress_url = f"/api/exercises/{exercise_id}/progress"
    assert (await client.get(progress_url, headers=user.headers)).json()["points"] == []
    await client.post(
        first + "/finish", headers=user.headers, json={"finished_at": datetime.now(UTC).isoformat()}
    )
    progress = (await client.get(progress_url, headers=user.headers)).json()
    assert progress["metric"] == "weight_kg"
    assert progress["max_weight_kg"] == 80
    assert progress["max_reps"] == 6
    assert len(progress["points"]) == 1
    await client.delete(f"/api/exercises/{exercise_id}", headers=user.headers)
    assert len((await client.get(progress_url, headers=user.headers)).json()["points"]) == 1


async def _finished_cardio(
    client: AsyncClient, user: Account, days: int, sets: list[tuple[int, float]]
) -> str:
    """Завершённая тренировка на дорожке с подходами «секунды, километры»; ключ упражнения."""
    path = await workout(client, user, days)
    exercise = await item(client, user, path, "treadmill_walk")
    for seconds, km in sets:
        saved = await client.put(
            exercise + f"/sets/{uuid.uuid7()}",
            headers=user.headers,
            json={"duration_seconds": seconds, "distance_value": km, "distance_unit": "km"},
        )
        assert saved.status_code == 201, saved.text
    finished_at = (datetime.now(UTC) + timedelta(days=days, hours=1)).isoformat()
    await client.post(path + "/finish", headers=user.headers, json={"finished_at": finished_at})
    detail = (await client.get(path, headers=user.headers)).json()
    return detail["exercises"][0]["exercise"]["id"]


async def test_cardio_progress_has_pace_and_records(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    # Короткий быстрый подход в лучший темп не идёт: он короче километра.
    await _finished_cardio(client, user, -3, [(1800, 5), (150, 0.5)])
    exercise_id = await _finished_cardio(client, user, -1, [(3000, 8.4)])

    progress = (
        await client.get(f"/api/exercises/{exercise_id}/progress", headers=user.headers)
    ).json()

    assert progress["pace_unit"] == "per_km"
    assert progress["best_pace_seconds_per_km"] == pytest.approx(3000 / 8.4)
    assert progress["max_distance_km"] == 8.4
    assert progress["max_duration_seconds"] == 3000
    assert [
        (point["distance_km"], point["duration_seconds"], point["pace_seconds_per_km"])
        for point in progress["cardio"]
    ] == [(5, 1800, 360), (8.4, 3000, pytest.approx(3000 / 8.4))]


async def test_strength_progress_has_no_pace(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    path = await workout(client, user, -1)
    await item(client, user, path, "deadlift")
    exercise_id = (await client.get(path, headers=user.headers)).json()["exercises"][0]["exercise"][
        "id"
    ]

    progress = (
        await client.get(f"/api/exercises/{exercise_id}/progress", headers=user.headers)
    ).json()

    assert progress["pace_unit"] is None
    assert progress["best_pace_seconds_per_km"] is None
    assert progress["cardio"] == []


async def finished_with_set(
    client: AsyncClient, user: Account, days: int, preset: str, reps: int
) -> tuple[str, str]:
    """Завершённая тренировка `days` дней назад с одним подходом; путь тренировки и ключ подхода."""
    path = await workout(client, user, days)
    exercise = await item(client, user, path, preset)
    set_id = str(uuid.uuid7())
    saved = await client.put(
        exercise + f"/sets/{set_id}", headers=user.headers, json={"reps": reps}
    )
    assert saved.status_code == 201, saved.text
    started = datetime.now(UTC) + timedelta(days=days)
    finished = await client.post(
        path + "/finish",
        headers=user.headers,
        json={"finished_at": (started + timedelta(hours=1)).isoformat()},
    )
    assert finished.status_code == 200
    return path, set_id


async def test_recent_copy_holds_last_days_active_workout_and_latest_sets(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    old, old_set = await finished_with_set(client, user, -20, "pull_up", 6)
    await finished_with_set(client, user, -20, "push_up", 10)
    middle, middle_set = await finished_with_set(client, user, -3, "push_up", 15)
    active = await workout(client, user)
    await item(client, user, active, "push_up")
    await finished_with_set(client, other, -1, "push_up", 99)

    copy = await client.get("/api/workouts/recent", headers=user.headers)

    assert copy.status_code == 200
    body = copy.json()
    assert [row["id"] for row in body["workouts"]] == [
        active.rsplit("/", 1)[1],
        middle.rsplit("/", 1)[1],
    ]
    assert body["workouts"][0]["exercises"][0]["previous"][0]["id"] == middle_set
    assert body["workouts"][1]["exercises"][0]["sets"][0]["reps"] == 15
    latest = {row["exercise_id"]: row for row in body["latest"]}
    assert len(latest) == 2
    by_set = {row["sets"][0]["id"]: row for row in latest.values()}
    assert by_set[middle_set]["workout_id"] == middle.rsplit("/", 1)[1]
    assert by_set[old_set]["workout_id"] == old.rsplit("/", 1)[1]


async def test_repeat_with_stale_composition_is_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    source, _ = await finished_with_set(client, user, -1, "pull_up", 5)
    detail = (await client.get(source, headers=user.headers)).json()
    exercise_id = detail["exercises"][0]["exercise"]["id"]
    plank = await client.post(
        "/api/exercises/presets", headers=user.headers, json={"preset": "plank"}
    )
    body = {
        "id": str(uuid.uuid7()),
        "item_ids": [str(uuid.uuid7())],
        "exercise_ids": [plank.json()["id"]],
        **moment(),
    }

    stale = await client.post(source + "/repeat", headers=user.headers, json=body)
    uneven = await client.post(
        source + "/repeat", headers=user.headers, json={**body, "exercise_ids": []}
    )
    fresh = await client.post(
        source + "/repeat", headers=user.headers, json={**body, "exercise_ids": [exercise_id]}
    )

    assert stale.status_code == 409
    assert stale.json() == {"detail": "workout_source_changed"}
    assert uneven.status_code == 422
    assert fresh.status_code == 201, fresh.text
