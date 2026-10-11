"""Общие шаги тестов питания: продукт в каталоге, приём пищи, запись в дневнике, день."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account

TODAY = datetime.now(UTC).date()
YESTERDAY = TODAY - timedelta(days=1)

COTTAGE_CHEESE = {
    "name": "Творог 5 %",
    "unit": "g",
    "kcal": 121,
    "protein_g": 17.2,
    "fat_g": 5,
    "carbs_g": 1.8,
}
OATMEAL = {
    "name": "Овсяные хлопья",
    "unit": "g",
    "kcal": 352,
    "protein_g": 12.3,
    "fat_g": 6.2,
    "carbs_g": 61.8,
}
PRESETS = ("breakfast", "lunch", "dinner", "snack")


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


async def read_day(client: AsyncClient, account: Account, day: Any = TODAY) -> dict[str, Any]:
    response = await client.get("/api/diary", params={"date": str(day)}, headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


def meal_of(day: dict[str, Any], meal: str) -> dict[str, Any]:
    """Приём пищи дня — по коду предустановленного, по своему названию или по ключу."""
    return next(item for item in day["meals"] if meal in (item["preset"], item["name"], item["id"]))


async def meal_id_of(client: AsyncClient, account: Account, meal: str) -> str:
    """Ключ приёма пищи из списка пользователя; не код и не название — значит, уже ключ."""
    if meal not in PRESETS:
        return meal
    return meal_of(await read_day(client, account), meal)["id"]


async def put_meal(
    client: AsyncClient, account: Account, name: str, meal_id: str | None = None
) -> Response:
    return await client.put(
        f"/api/diary/meals/{meal_id or uuid.uuid7()}", headers=account.headers, json={"name": name}
    )


async def add_meal(client: AsyncClient, account: Account, name: str = "Второй завтрак") -> str:
    """Добавляет в список свой приём пищи и возвращает его ключ."""
    response = await put_meal(client, account, name)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def put_entry(
    client: AsyncClient,
    account: Account,
    product_id: str | None,
    amount: float = 150,
    *,
    meal: str = "breakfast",
    day: Any = TODAY,
    entry_id: str | None = None,
) -> Response:
    """Вносит запись; `meal` — код предустановленного приёма пищи или ключ любого."""
    return await client.put(
        f"/api/diary/entries/{entry_id or uuid.uuid7()}",
        headers=account.headers,
        json={
            "local_date": str(day),
            "meal_id": await meal_id_of(client, account, meal),
            "product_id": product_id,
            "amount": amount,
        },
    )


async def add_entry(
    client: AsyncClient, account: Account, product_id: str, amount: float = 150, **where: Any
) -> str:
    response = await put_entry(client, account, product_id, amount, **where)
    assert response.status_code == 201, response.text
    return response.json()["id"]
