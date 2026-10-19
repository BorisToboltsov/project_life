"""Общие шаги тестов анализов: бланк, значение, свой показатель."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account


def day(days_ago: int = 0) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).date().isoformat()


def report(days_ago: int = 0, **overrides: Any) -> dict[str, Any]:
    """Шапка бланка: по умолчанию — сегодня, лаборатория «Инвитро»."""
    return {"local_date": day(days_ago), "lab": "Инвитро", **overrides}


def preset_value(
    preset: str = "hemoglobin", value: float = 142, unit: str = "g_l", **overrides: Any
) -> dict[str, Any]:
    """Значение штатного показателя: по умолчанию — гемоглобин 142 г/л с референсом."""
    return {
        "preset": preset,
        "value": value,
        "unit": unit,
        "ref_low": 120,
        "ref_high": 160,
        **overrides,
    }


def own_value(analyte_id: str, value: float = 3.1, **overrides: Any) -> dict[str, Any]:
    return {"analyte_id": analyte_id, "value": value, **overrides}


async def put_report(
    client: AsyncClient,
    account: Account,
    body: dict[str, Any] | None = None,
    report_id: str | None = None,
) -> Response:
    key = report_id or str(uuid.uuid7())
    return await client.put(
        f"/api/lab-reports/{key}", headers=account.headers, json=body or report()
    )


async def add_report(client: AsyncClient, account: Account, **overrides: Any) -> str:
    response = await put_report(client, account, report(**overrides))
    assert response.status_code == 201
    return response.json()["id"]


async def put_value(
    client: AsyncClient,
    account: Account,
    report_id: str,
    body: dict[str, Any] | None = None,
    value_id: str | None = None,
) -> Response:
    key = value_id or str(uuid.uuid7())
    return await client.put(
        f"/api/lab-reports/{report_id}/values/{key}",
        headers=account.headers,
        json=body or preset_value(),
    )


async def put_analyte(
    client: AsyncClient,
    account: Account,
    name: str = "Антитела к ТПО",
    unit: str = "МЕ/мл",
    analyte_id: str | None = None,
) -> Response:
    key = analyte_id or str(uuid.uuid7())
    return await client.put(
        f"/api/lab-analytes/{key}", headers=account.headers, json={"name": name, "unit": unit}
    )


async def add_analyte(client: AsyncClient, account: Account, **overrides: Any) -> str:
    response = await put_analyte(client, account, **overrides)
    assert response.status_code == 201
    return response.json()["id"]


async def reports(client: AsyncClient, account: Account) -> list[dict[str, Any]]:
    response = await client.get("/api/lab-reports", headers=account.headers)
    assert response.status_code == 200
    return response.json()


async def analytes(client: AsyncClient, account: Account) -> dict[str, Any]:
    response = await client.get("/api/lab-analytes", headers=account.headers)
    assert response.status_code == 200
    return response.json()
