import asyncio
from decimal import Decimal
from typing import Any

import httpx
import pytest

from app.models import Language
from app.nutrition import ProductUnit
from app.services import open_food_facts
from app.services.open_food_facts import Miss, OffProduct, OpenFoodFacts, parse
from tests.conftest import OffStub
from tests.nutrition import EAN_13, OFF_COTTAGE_CHEESE

pytestmark = pytest.mark.anyio


def nutriments(**values: Any) -> dict[str, Any]:
    return {"product_name": "Продукт", "nutriments": values}


# --- Разбор ответа -----------------------------------------------------------------------


def test_complete_product_comes_in_catalog_measures() -> None:
    assert parse(OFF_COTTAGE_CHEESE, Language.RU) == OffProduct(
        name="Творог 5 %, Простоквашино",
        unit=ProductUnit.G,
        kcal=Decimal("121.0"),
        protein_g=Decimal("17.20"),
        fat_g=Decimal("5.00"),
        carbs_g=Decimal("1.80"),
    )


@pytest.mark.parametrize(
    ("product", "language", "expected"),
    [
        # Название на языке пользователя важнее названия с упаковки.
        (
            {"product_name": "Fromage blanc", "product_name_ru": "Творог"},
            Language.RU,
            "Творог",
        ),
        (
            {"product_name": "Fromage blanc", "product_name_ru": "Творог"},
            Language.EN,
            "Fromage blanc",
        ),
        ({"product_name": "", "product_name_en": "Cottage cheese"}, Language.RU, "Cottage cheese"),
        # Марка добавляется, только если её нет в названии.
        (
            {"product_name": "Творог", "brands": "Простоквашино,Danone"},
            Language.RU,
            "Творог, Простоквашино",
        ),
        (
            {"product_name": "Творог простоквашино", "brands": "Простоквашино"},
            Language.RU,
            "Творог простоквашино",
        ),
        # Лишние пробелы и переводы строк — не часть названия.
        ({"product_name": "  Творог \n 5 %  "}, Language.RU, "Творог 5 %"),
        # Название длиннее, чем принимает каталог, обрезается; марка тогда не добавляется.
        ({"product_name": "я" * 130, "brands": "Марка"}, Language.RU, "я" * 120),
        ({"product_name": "я" * 118, "brands": "Марка"}, Language.RU, "я" * 118),
        ({"brands": "Простоквашино"}, Language.RU, None),
        ({"product_name": 42}, Language.RU, None),
    ],
)
def test_name_is_chosen_for_the_user(
    product: dict[str, Any], language: Language, expected: str | None
) -> None:
    assert parse(product, language).name == expected


@pytest.mark.parametrize(
    ("product", "unit"),
    [
        ({"product_quantity_unit": "ml"}, ProductUnit.ML),
        ({"product_quantity_unit": "g"}, ProductUnit.G),
        ({"quantity": "1 l"}, ProductUnit.ML),
        ({"quantity": "0,5 л"}, ProductUnit.ML),
        ({"quantity": "500ml"}, ProductUnit.ML),
        ({"quantity": "330 мл."}, ProductUnit.ML),
        ({"quantity": "450 г"}, ProductUnit.G),
        ({"quantity": "6 x 125 g"}, ProductUnit.G),
        ({"quantity": "12"}, ProductUnit.G),
        ({}, ProductUnit.G),
    ],
)
def test_drink_is_measured_in_millilitres(product: dict[str, Any], unit: ProductUnit) -> None:
    assert parse(product, Language.RU).unit == unit


@pytest.mark.parametrize(
    ("values", "kcal"),
    [
        ({"energy-kcal_100g": 121.04}, "121.0"),
        ({"energy-kcal_100g": "64,5"}, "64.5"),
        # Килоджоули пересчитываются: 506 кДж — 120,9 ккал.
        ({"energy-kj_100g": 506}, "120.9"),
        ({"energy_100g": 506}, "120.9"),
        # Килокалории с упаковки важнее пересчёта.
        ({"energy-kcal_100g": 121, "energy-kj_100g": 999}, "121.0"),
        # Энергии нет — она считается по белкам, жирам и углеводам: 17,2 × 4 + 5 × 9 + 1,8 × 4.
        ({"proteins_100g": 17.2, "fat_100g": 5, "carbohydrates_100g": 1.8}, "121.0"),
        ({"energy-kcal_100g": 0}, "0.0"),
    ],
)
def test_energy_is_in_kilocalories(values: dict[str, Any], kcal: str) -> None:
    assert parse(nutriments(**values), Language.RU).kcal == Decimal(kcal)


@pytest.mark.parametrize(
    "values",
    [
        {},
        {"proteins_100g": 17.2, "fat_100g": 5},
        {"energy-kcal_100g": 901},
        {"energy-kcal_100g": -1},
        {"energy-kcal_100g": "много"},
        {"energy-kcal_100g": None},
        {"energy-kcal_100g": True},
        {"energy-kcal_100g": float("nan")},
        {"energy-kcal_100g": [121]},
    ],
)
def test_impossible_energy_is_unknown(values: dict[str, Any]) -> None:
    assert parse(nutriments(**values), Language.RU).kcal is None


def test_impossible_macronutrient_is_unknown() -> None:
    found = parse(
        nutriments(proteins_100g=100.5, fat_100g=-0.1, carbohydrates_100g="61,849"), Language.RU
    )

    assert (found.protein_g, found.fat_g, found.carbs_g) == (None, None, Decimal("61.85"))


def test_product_without_nutrition_facts_is_parsed_too() -> None:
    assert parse({"product_name": "Чай", "nutriments": "нет"}, Language.RU) == OffProduct(
        name="Чай", unit=ProductUnit.G, kcal=None, protein_g=None, fat_g=None, carbs_g=None
    )


# --- Запрос ------------------------------------------------------------------------------


def client_of(stub: OffStub) -> OpenFoodFacts:
    return OpenFoodFacts("https://off.test/", httpx.MockTransport(stub.respond))


async def test_product_is_asked_by_barcode() -> None:
    stub = OffStub(products={EAN_13: OFF_COTTAGE_CHEESE})

    found = await client_of(stub).product(EAN_13, Language.RU)

    assert isinstance(found, OffProduct)
    assert found.name == "Творог 5 %, Простоквашино"
    assert [str(request.url.copy_with(query=None)) for request in stub.requests] == [
        f"https://off.test/api/v2/product/{EAN_13}"
    ]


async def test_unknown_barcode_is_not_found() -> None:
    assert await client_of(OffStub()).product(EAN_13, Language.RU) is Miss.NOT_FOUND


async def test_older_api_reports_not_found_with_status_zero() -> None:
    stub = OffStub(broken=httpx.Response(200, json={"status": 0, "code": EAN_13}))

    assert await client_of(stub).product(EAN_13, Language.RU) is Miss.NOT_FOUND


@pytest.mark.parametrize(
    "broken",
    [
        httpx.Response(500, json={"status": 0}),
        httpx.Response(429, json={"status": 0}),
        httpx.Response(302, headers={"Location": "https://elsewhere.test/"}),
        # 404 без слова самого сервиса: адрес ведёт не туда.
        httpx.Response(404, text="Not Found"),
        httpx.Response(404, json={"error": "no such route"}),
        httpx.Response(200, text="<html>maintenance</html>"),
        httpx.Response(200, json=["status", 1]),
        httpx.Response(200, json={"status": 1}),
        httpx.Response(200, json={"status": 1, "product": "Творог"}),
        httpx.Response(200, json={"status": "ok", "product": OFF_COTTAGE_CHEESE}),
        httpx.ConnectError("нет сети"),
        httpx.ReadTimeout("молчит"),
    ],
)
async def test_anything_else_means_the_source_is_unavailable(
    broken: httpx.Response | Exception,
) -> None:
    assert await client_of(OffStub(broken=broken)).product(EAN_13, Language.RU) is Miss.UNAVAILABLE


async def test_slow_answer_is_not_awaited(monkeypatch: pytest.MonkeyPatch) -> None:
    async def hang(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(60)
        return httpx.Response(200)

    monkeypatch.setattr(open_food_facts, "TIMEOUT_SECONDS", 0.05)
    slow = OpenFoodFacts("https://off.test", httpx.MockTransport(hang))

    assert await slow.product(EAN_13, Language.RU) is Miss.UNAVAILABLE


async def test_requests_to_the_source_are_paced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(open_food_facts, "OVERALL_LIMIT", 2)
    stub = OffStub(products={EAN_13: OFF_COTTAGE_CHEESE})
    source = client_of(stub)

    answers = [await source.product(EAN_13, Language.RU) for _ in range(3)]

    assert isinstance(answers[1], OffProduct)
    assert answers[2] is Miss.UNAVAILABLE
    # Третий запрос наружу не ушёл.
    assert len(stub.requests) == 2


def test_source_without_an_address_is_switched_off() -> None:
    assert not OpenFoodFacts("").enabled
    assert OpenFoodFacts("https://off.test").enabled
