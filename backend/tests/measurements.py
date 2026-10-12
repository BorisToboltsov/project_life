"""Общие шаги тестов замеров: список видов пользователя, свой вид, замер."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account

NOW = datetime.now(UTC)
# С этими видами начинает каждый пользователь.
STARTING = ("weight", "neck", "waist", "hips")
# Штатные виды, которые человек добавляет сам.
RECOMMENDED = ("chest", "shoulders", "biceps", "forearm", "thigh", "calf", "body_fat")


async def list_metrics(client: AsyncClient, account: Account) -> dict[str, Any]:
    response = await client.get("/api/metrics", headers=account.headers)
    assert response.status_code == 200
    return response.json()


async def metric_id(client: AsyncClient, account: Account, preset: str = "weight") -> str:
    """Ключ штатного вида в списке пользователя; вида нет в списке — он добавляется."""
    for metric in (await list_metrics(client, account))["metrics"]:
        if metric["preset"] == preset:
            return metric["id"]
    return (await add_preset(client, account, preset)).json()["id"]


async def add_preset(client: AsyncClient, account: Account, preset: str) -> Response:
    return await client.post(
        "/api/metrics/presets", headers=account.headers, json={"preset": preset}
    )


async def put_metric(
    client: AsyncClient,
    account: Account,
    name: str = "Запястье",
    quantity: str = "length",
    record_id: str | None = None,
) -> Response:
    return await client.put(
        f"/api/metrics/{record_id or uuid.uuid7()}",
        headers=account.headers,
        json={"name": name, "quantity": quantity},
    )


async def add_metric(
    client: AsyncClient, account: Account, name: str = "Запястье", quantity: str = "length"
) -> str:
    response = await put_metric(client, account, name, quantity)
    assert response.status_code == 201
    return response.json()["id"]


async def remove_metric(client: AsyncClient, account: Account, record_id: str) -> Response:
    return await client.delete(f"/api/metrics/{record_id}", headers=account.headers)


def reading(metric: str, /, **overrides: Any) -> dict[str, Any]:
    """Тело запроса с замером: по умолчанию — вес сейчас."""
    return {
        "metric_id": metric,
        "value": 72.4,
        "unit": "kg",
        "measured_at": NOW.isoformat(),
        "local_date": NOW.date().isoformat(),
        **overrides,
    }


def days_ago(days: int) -> dict[str, str]:
    moment = NOW - timedelta(days=days)
    return {"measured_at": moment.isoformat(), "local_date": moment.date().isoformat()}


async def put_measurement(
    client: AsyncClient, account: Account, payload: dict[str, Any], record_id: str | None = None
) -> Response:
    return await client.put(
        f"/api/measurements/{record_id or uuid.uuid7()}", headers=account.headers, json=payload
    )


async def history(client: AsyncClient, account: Account, metric: str, **period: str) -> list[Any]:
    response = await client.get(
        "/api/measurements", params={"metric_id": metric, **period}, headers=account.headers
    )
    assert response.status_code == 200
    return response.json()
