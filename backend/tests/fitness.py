"""Общие шаги тестов результатов физических тестов."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account


def moment(days_ago: int = 0) -> dict[str, str]:
    at = datetime.now(UTC) - timedelta(days=days_ago)
    return {"tested_at": at.isoformat(), "local_date": at.date().isoformat()}


def cooper(value: float = 2650, unit: str = "m", days_ago: int = 0) -> dict[str, Any]:
    return {"test": "cooper", "distance_value": value, "distance_unit": unit, **moment(days_ago)}


def push_ups(reps: int = 38, variant: str = "classic", days_ago: int = 0) -> dict[str, Any]:
    return {"test": "push_ups", "reps": reps, "variant": variant, **moment(days_ago)}


def pull_ups(reps: int = 11, days_ago: int = 0) -> dict[str, Any]:
    return {"test": "pull_ups", "reps": reps, **moment(days_ago)}


async def put_result(
    client: AsyncClient, user: Account, body: dict[str, Any], result_id: str | None = None
) -> Response:
    key = result_id or str(uuid.uuid7())
    return await client.put(f"/api/fitness-results/{key}", headers=user.headers, json=body)


async def results(client: AsyncClient, user: Account) -> list[dict[str, Any]]:
    response = await client.get("/api/fitness-results", headers=user.headers)
    assert response.status_code == 200
    return response.json()
