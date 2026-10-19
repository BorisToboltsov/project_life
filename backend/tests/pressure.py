"""Общие шаги тестов давления."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account


def bp(
    systolic: int = 128, diastolic: int = 82, pulse: int | None = 64, days_ago: int = 0
) -> dict[str, Any]:
    """Показание тонометра: по умолчанию — 128/82, пульс 64, сейчас."""
    at = datetime.now(UTC) - timedelta(days=days_ago)
    return {
        "measured_at": at.isoformat(),
        "local_date": at.date().isoformat(),
        "systolic": systolic,
        "diastolic": diastolic,
        "pulse": pulse,
    }


async def put_bp(
    client: AsyncClient, account: Account, body: dict[str, Any], reading_id: str | None = None
) -> Response:
    key = reading_id or str(uuid.uuid7())
    return await client.put(f"/api/blood-pressure/{key}", headers=account.headers, json=body)


async def readings(client: AsyncClient, account: Account) -> list[dict[str, Any]]:
    response = await client.get("/api/blood-pressure", headers=account.headers)
    assert response.status_code == 200
    return response.json()
