"""Общие шаги тестов питания: продукт в каталоге, запись в дневнике, день."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account

TODAY = datetime.now(UTC).date()
YESTERDAY = TODAY - timedelta(days=1)

COTTAGE_CHEESE = {"name": "Творог 5 %", "kcal": 121, "protein_g": 17.2, "fat_g": 5, "carbs_g": 1.8}
OATMEAL = {"name": "Овсяные хлопья", "kcal": 352, "protein_g": 12.3, "fat_g": 6.2, "carbs_g": 61.8}


async def put_product(
    client: AsyncClient, account: Account, body: dict[str, Any], product_id: str | None = None
) -> Response:
    return await client.put(
        f"/api/products/{product_id or uuid.uuid7()}", headers=account.headers, json=body
    )


async def add_product(client: AsyncClient, account: Account, **fields: Any) -> str:
    """Создаёт продукт (по умолчанию творог) и возвращает его ключ."""
    response = await put_product(client, account, {**COTTAGE_CHEESE, **fields})
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def put_entry(
    client: AsyncClient,
    account: Account,
    product_id: str | None,
    amount_g: float = 150,
    *,
    meal: str = "breakfast",
    day: Any = TODAY,
    entry_id: str | None = None,
) -> Response:
    return await client.put(
        f"/api/diary/entries/{entry_id or uuid.uuid7()}",
        headers=account.headers,
        json={
            "local_date": str(day),
            "meal": meal,
            "product_id": product_id,
            "amount_g": amount_g,
        },
    )


async def add_entry(
    client: AsyncClient, account: Account, product_id: str, amount_g: float = 150, **where: Any
) -> str:
    response = await put_entry(client, account, product_id, amount_g, **where)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def read_day(client: AsyncClient, account: Account, day: Any = TODAY) -> dict[str, Any]:
    response = await client.get("/api/diary", params={"date": str(day)}, headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


def meal_of(day: dict[str, Any], meal: str) -> dict[str, Any]:
    return next(item for item in day["meals"] if item["meal"] == meal)
