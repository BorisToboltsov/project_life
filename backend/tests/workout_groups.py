"""Общие данные сценариев групп тренировок."""

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient

from tests.conftest import Account


async def create_group(client: AsyncClient, user: Account) -> tuple[str, dict[str, Any]]:
    exercise = await client.post(
        "/api/exercises/presets", headers=user.headers, json={"preset": "deadlift"}
    )
    body = {
        "name": "Спина",
        "exercise_ids": [exercise.json()["id"]],
        "weekdays": [0, 3],
        "start_date": "2026-10-19",
        "end_date": "2026-11-01",
        "dates": ["2026-10-18", "2026-11-05"],
    }
    path = f"/api/workout-groups/{uuid.uuid7()}"
    response = await client.put(path, headers=user.headers, json=body)
    assert response.status_code == 201, response.text
    return path, body


def start_body(count: int = 1) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "id": str(uuid.uuid7()),
        "item_ids": [str(uuid.uuid7()) for _ in range(count)],
        "started_at": now.isoformat(),
        "local_date": now.date().isoformat(),
    }
