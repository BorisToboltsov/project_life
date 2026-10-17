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
# Чего нет на этикетке или что с неё не внесли.
NO_LABEL = {"sugars_g": None, "saturated_fat_g": None, "fiber_g": None, "salt_g": None}
# Что ещё печатают на этикетке кроме калорий, белков, жиров и углеводов.
LABEL = {"sugars_g": 1.8, "saturated_fat_g": 3.2, "fiber_g": 0, "salt_g": 0.1}
# У продукта нет ни порции, ни упаковки: его вносят только в его единицах.
NO_PORTIONS = {"serving_size": None, "package_size": None}
# Яйцо: штука — порция, десяток — упаковка.
PORTIONS = {"serving_size": 60, "package_size": 600}
# Чем API дополняет продукт, который человек завёл без штрихкода, этикетки и порций.
BY_HAND = {"recipe": None, **NO_LABEL, **NO_PORTIONS, "barcode": None, "source": "user"}
PRESETS = ("breakfast", "lunch", "dinner", "snack")

# Штрихкоды с верной контрольной цифрой.
EAN_13 = "4600000000008"
EAN_8 = "46012340"
# Один и тот же код: UPC-A и он же как EAN-13.
UPC_A = "036000291452"
UPC_A_AS_EAN_13 = "0036000291452"
# Яйцо, как его заводят руками: штука и десяток.
EGG = {
    "name": "Яйцо куриное",
    "unit": "g",
    "kcal": 157,
    "protein_g": 12.7,
    "fat_g": 11.5,
    "carbs_g": 0.7,
    **PORTIONS,
}
# Продукт, как его отдаёт Open Food Facts: состав на 100 г полный.
OFF_COTTAGE_CHEESE: dict[str, Any] = {
    "product_name": "Творог 5 %",
    "brands": "Простоквашино, Danone",
    "quantity": "200 г",
    "nutriments": {
        "energy-kcal_100g": 121,
        "proteins_100g": 17.2,
        "fat_100g": 5,
        "carbohydrates_100g": 1.8,
    },
}
# Тот же состав с тем, что ещё печатают на этикетке.
OFF_LABEL = {"sugars_100g": 1.8, "saturated-fat_100g": 3.2, "fiber_100g": 0, "salt_100g": 0.1}


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


async def search(client: AsyncClient, account: Account, q: str = "") -> list[dict[str, Any]]:
    """Первая страница своего каталога."""
    response = await client.get("/api/products", params={"q": q}, headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def search_outside(
    client: AsyncClient, account: Account, q: str, page: int | None = None
) -> Response:
    """Страница поиска по названию в Open Food Facts."""
    params = {"q": q} if page is None else {"q": q, "page": page}
    return await client.get("/api/products/external", params=params, headers=account.headers)


def off_hit(barcode: str, **fields: Any) -> dict[str, Any]:
    """Продукт, как его отдаёт поиск Open Food Facts: со штрихкодом и марками списком."""
    return {**OFF_COTTAGE_CHEESE, "code": barcode, "brands": ["Простоквашино", "Danone"], **fields}


async def lookup(client: AsyncClient, account: Account, barcode: str) -> Response:
    return await client.post(
        "/api/products/lookup", headers=account.headers, json={"barcode": barcode}
    )


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


def servings(count: float) -> dict[str, Any]:
    """Количество порциями продукта — вместо количества в его единицах."""
    return {"kind": "serving", "count": count}


def packages(count: float) -> dict[str, Any]:
    """То же упаковками."""
    return {"kind": "package", "count": count}


async def put_entry(
    client: AsyncClient,
    account: Account,
    product_id: str | None,
    amount: float | dict[str, Any] = 150,
    *,
    meal: str = "breakfast",
    day: Any = TODAY,
    entry_id: str | None = None,
) -> Response:
    """Вносит запись; `meal` — код предустановленного приёма пищи или ключ любого,
    `amount` — количество в единицах продукта либо порции (`servings`, `packages`)."""
    how_much = {"portion": amount} if isinstance(amount, dict) else {"amount": amount}
    return await client.put(
        f"/api/diary/entries/{entry_id or uuid.uuid7()}",
        headers=account.headers,
        json={
            "local_date": str(day),
            "meal_id": await meal_id_of(client, account, meal),
            "product_id": product_id,
            **how_much,
        },
    )


async def add_entry(
    client: AsyncClient,
    account: Account,
    product_id: str,
    amount: float | dict[str, Any] = 150,
    **where: Any,
) -> str:
    response = await put_entry(client, account, product_id, amount, **where)
    assert response.status_code == 201, response.text
    return response.json()["id"]
