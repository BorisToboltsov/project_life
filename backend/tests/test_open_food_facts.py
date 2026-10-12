import asyncio
from decimal import Decimal
from typing import Any

import httpx
import pytest

from app.models import Language
from app.nutrition import ProductUnit
from app.services import open_food_facts
from app.services.open_food_facts import (
    SEARCH_FIELDS,
    Miss,
    OffListing,
    OffProduct,
    OffSearchPage,
    OpenFoodFacts,
    parse,
    search_terms,
)
from tests.conftest import SEARCH_HOST, OffStub
from tests.nutrition import EAN_8, EAN_13, OFF_COTTAGE_CHEESE, OFF_LABEL, UPC_A, off_hit

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


def test_label_carries_more_than_the_four_main_values() -> None:
    found = parse(nutriments(**OFF_COTTAGE_CHEESE["nutriments"], **OFF_LABEL), Language.RU)

    assert (found.sugars_g, found.saturated_fat_g, found.fiber_g, found.salt_g) == (
        Decimal("1.80"),
        Decimal("3.20"),
        Decimal("0.00"),
        Decimal("0.10"),
    )


@pytest.mark.parametrize(
    ("values", "sugars", "saturated"),
    [
        # Часть равна целому — так бывает: сахар, сливочное масло.
        ({"carbohydrates_100g": 99.8, "sugars_100g": 99.8}, "99.80", None),
        ({"fat_100g": 82.5, "saturated-fat_100g": 82.5}, None, "82.50"),
        # Часть больше целого — ошибка в источнике.
        ({"carbohydrates_100g": 4.7, "sugars_100g": 4.71}, None, None),
        ({"fat_100g": 3.2, "saturated-fat_100g": 32}, None, None),
        # Целое неизвестно — сверить не с чем: значение остаётся, сверит форма.
        ({"sugars_100g": 4.7, "saturated-fat_100g": 2}, "4.70", "2.00"),
        ({"sugars_100g": 100.5, "saturated-fat_100g": "мало"}, None, None),
    ],
)
def test_part_is_not_bigger_than_the_whole(
    values: dict[str, Any], sugars: str | None, saturated: str | None
) -> None:
    found = parse(nutriments(**values), Language.RU)

    assert found.sugars_g == (Decimal(sugars) if sugars else None)
    assert found.saturated_fat_g == (Decimal(saturated) if saturated else None)


def test_product_without_nutrition_facts_is_parsed_too() -> None:
    assert parse({"product_name": "Чай", "nutriments": "нет"}, Language.RU) == OffProduct(
        name="Чай", unit=ProductUnit.G, kcal=None, protein_g=None, fat_g=None, carbs_g=None
    )


# --- Запрос ------------------------------------------------------------------------------


def client_of(stub: OffStub, **pace: int) -> OpenFoodFacts:
    return OpenFoodFacts(
        "https://off.test/",
        httpx.MockTransport(stub.respond),
        search_url=f"https://{SEARCH_HOST}/",
        **pace,
    )


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


async def test_requests_to_the_source_are_paced() -> None:
    stub = OffStub(products={EAN_13: OFF_COTTAGE_CHEESE})
    source = client_of(stub, products_per_minute=2)

    answers = [await source.product(EAN_13, Language.RU) for _ in range(3)]

    assert isinstance(answers[1], OffProduct)
    assert answers[2] is Miss.UNAVAILABLE
    # Третий запрос наружу не ушёл.
    assert len(stub.requests) == 2


def test_source_without_an_address_is_switched_off() -> None:
    assert not OpenFoodFacts("").enabled
    assert OpenFoodFacts("https://off.test").enabled


# --- Поиск по названию -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("typed", "sent"),
    [
        ("Творог", "творог"),
        ("  Творог   5 %  ", "творог 5 %"),
        ("Молоко 3,2% «Простоквашино»", "молоко 3,2% простоквашино"),
        ("Coca-Cola Zero", "coca cola zero"),
        # Язык запросов сервиса до него не доходит: ни поля, ни скобки, ни операторы.
        ('brands:"Danone" AND (кефир OR йогурт)', "brands danone and кефир or йогурт"),
        ("кефир~2 -сахар +био *", "кефир 2 сахар био"),
        ("сыр_плавленый\\/", "сыр плавленый"),
        ("?!", ""),
        ("", ""),
    ],
)
def test_search_text_goes_out_as_plain_words(typed: str, sent: str) -> None:
    assert search_terms(typed) == sent


async def test_products_are_searched_by_name() -> None:
    stub = OffStub(hits=[off_hit(EAN_13), off_hit(EAN_8, product_name="Творог 9 %")])
    source = client_of(stub)

    found = await source.search("творог", 1)

    assert isinstance(found, OffSearchPage)
    assert found.products(Language.RU) == [
        # Марки в выдаче — список; в название идёт первая, как у продукта по штрихкоду.
        OffListing(EAN_13, "Творог 5 %, Простоквашино", parse(OFF_COTTAGE_CHEESE, Language.RU)),
        OffListing(
            EAN_8,
            "Творог 9 %, Простоквашино",
            parse({**OFF_COTTAGE_CHEESE, "product_name": "Творог 9 %"}, Language.RU),
        ),
    ]
    assert not found.has_more
    [request] = stub.requests
    assert request.url.copy_with(query=None) == f"https://{SEARCH_HOST}/search"
    assert dict(request.url.params) == {
        "q": "творог",
        "langs": "en,ru",
        "page_size": "20",
        "page": "1",
        "fields": SEARCH_FIELDS,
    }


async def test_name_in_search_results_follows_the_language() -> None:
    stub = OffStub(hits=[off_hit(EAN_13, brands=[], product_name_en="Cottage cheese")])

    found = await client_of(stub).search("творог", 1)

    assert isinstance(found, OffSearchPage)
    assert [listing.name for listing in found.products(Language.EN)] == ["Cottage cheese"]
    assert [listing.name for listing in found.products(Language.RU)] == ["Творог 5 %"]


async def test_only_products_the_catalog_can_take_are_listed() -> None:
    stub = OffStub(
        hits=[
            # Без названия, со штрихкодом не той длины или с неверной контрольной цифрой
            # продукт выбрать было бы нельзя.
            off_hit(EAN_13, product_name=""),
            off_hit("46000000000"),
            off_hit("4600000000000"),
            {"product_name": "Без штрихкода"},
            "не продукт",
            # UPC-A — тот же EAN-13: в каталоге он хранится с ведущим нулём.
            off_hit(UPC_A),
            off_hit(EAN_8, brands="Простоквашино, Danone", nutriments={}),
        ]
    )

    found = await client_of(stub).search("творог", 1)

    assert isinstance(found, OffSearchPage)
    listed = found.products(Language.RU)
    assert [listing.barcode for listing in listed] == [f"0{UPC_A}", EAN_8]
    # Продукт без состава показывается: его дополнят при выборе.
    assert (listed[1].name, listed[1].product.kcal) == ("Творог 5 %, Простоквашино", None)


async def test_search_results_come_page_by_page() -> None:
    stub = OffStub(hits=[off_hit(EAN_13)] * 45)
    source = client_of(stub)

    pages = [await source.search("творог", number) for number in (1, 2, 3)]

    assert all(isinstance(page, OffSearchPage) for page in pages)
    assert [len(page.hits) for page in pages if isinstance(page, OffSearchPage)] == [20, 20, 5]
    assert [page.has_more for page in pages if isinstance(page, OffSearchPage)] == [
        True,
        True,
        False,
    ]
    assert [request.url.params["page"] for request in stub.requests] == ["1", "2", "3"]


async def test_search_does_not_page_past_what_the_service_gives() -> None:
    stub = OffStub(
        broken=httpx.Response(200, json={"hits": [off_hit(EAN_13)], "page_count": 100_000})
    )
    source = client_of(stub)

    last, before = (
        await source.search("творог", open_food_facts.SEARCH_MAX_PAGE),
        await source.search("творог", open_food_facts.SEARCH_MAX_PAGE - 1),
    )

    assert isinstance(last, OffSearchPage)
    assert isinstance(before, OffSearchPage)
    assert (last.has_more, before.has_more) == (False, True)


async def test_recent_search_is_recalled_without_asking_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = OffStub(hits=[off_hit(EAN_13)])
    source = client_of(stub)
    now = 1000.0
    monkeypatch.setattr(open_food_facts.time, "monotonic", lambda: now)

    assert source.recalled("творог", 1) is None
    found = await source.search("творог", 1)

    assert source.recalled("творог", 1) is found
    # Другой текст и другая страница — другой вопрос.
    assert source.recalled("кефир", 1) is None
    assert source.recalled("творог", 2) is None
    now += open_food_facts.SEARCH_TTL.total_seconds()
    assert source.recalled("творог", 1) is None


async def test_only_so_many_searches_are_remembered(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(open_food_facts, "SEARCH_REMEMBERED", 2)
    source = client_of(OffStub(hits=[off_hit(EAN_13)]))

    for text in ("творог", "кефир", "хлеб"):
        await source.search(text, 1)

    assert source.recalled("творог", 1) is None
    assert source.recalled("кефир", 1) is not None
    assert source.recalled("хлеб", 1) is not None


@pytest.mark.parametrize(
    "broken",
    [
        httpx.Response(500, json={"hits": []}),
        httpx.Response(429, json={"hits": []}),
        httpx.Response(400, json={"detail": "1 validation error for SearchParameters"}),
        httpx.Response(200, text="<html>maintenance</html>"),
        httpx.Response(200, json=[off_hit(EAN_13)]),
        httpx.Response(200, json={"page_count": 1}),
        httpx.Response(200, json={"hits": "много", "page_count": 1}),
        httpx.ConnectError("нет сети"),
        httpx.ReadTimeout("молчит"),
    ],
)
async def test_failed_search_is_unavailable_and_not_remembered(
    broken: httpx.Response | Exception,
) -> None:
    source = client_of(OffStub(broken=broken))

    assert await source.search("творог", 1) is Miss.UNAVAILABLE
    assert source.recalled("творог", 1) is None


async def test_search_without_a_page_count_has_no_next_page() -> None:
    source = client_of(OffStub(broken=httpx.Response(200, json={"hits": [off_hit(EAN_13)]})))

    found = await source.search("творог", 1)

    assert isinstance(found, OffSearchPage)
    assert (len(found.hits), found.has_more) == (1, False)


async def test_searches_are_paced_apart_from_barcodes() -> None:
    stub = OffStub(hits=[off_hit(EAN_13)], products={EAN_13: OFF_COTTAGE_CHEESE})
    source = client_of(stub, searches_per_minute=2)

    answers = [await source.search(text, 1) for text in ("творог", "кефир", "хлеб")]

    assert isinstance(answers[1], OffSearchPage)
    assert answers[2] is Miss.UNAVAILABLE
    assert len(stub.requests) == 2
    # У запросов по штрихкоду счёт свой.
    assert isinstance(await source.product(EAN_13, Language.RU), OffProduct)


def test_pace_of_the_real_service_is_the_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Пределы берегут настоящий сервис — 15 запросов продукта и 10 поисков в минуту с
    адреса; поднять их может только настройка, как на стенде с подменным сервисом."""
    from app.config import Settings

    paced = Settings()
    monkeypatch.setenv("LIFE_OFF_PRODUCTS_PER_MINUTE", "600")
    monkeypatch.setenv("LIFE_OFF_SEARCHES_PER_MINUTE", "500")
    raised = Settings()

    assert (paced.off_products_per_minute, paced.off_searches_per_minute) == (12, 8)
    assert paced.off_products_per_minute < 15
    assert paced.off_searches_per_minute < 10
    assert (raised.off_products_per_minute, raised.off_searches_per_minute) == (600, 500)


async def test_configured_pace_reaches_the_client(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("LIFE_OFF_URL", "https://off.test")
    monkeypatch.setenv("LIFE_OFF_PRODUCTS_PER_MINUTE", "1")
    get_settings.cache_clear()
    open_food_facts.get_open_food_facts.cache_clear()
    try:
        source = open_food_facts.get_open_food_facts()
        monkeypatch.setattr(source, "_transport", httpx.MockTransport(OffStub().respond))

        assert await source.product(EAN_13, Language.RU) is Miss.NOT_FOUND
        # Второй запрос отсечён пределом из настройки: наружу он не ушёл.
        assert await source.product(EAN_13, Language.RU) is Miss.UNAVAILABLE
    finally:
        # Настройки и клиент кэшируются на весь процесс: остальным тестам нужны прежние.
        monkeypatch.undo()
        get_settings.cache_clear()
        open_food_facts.get_open_food_facts.cache_clear()


def test_search_needs_both_addresses() -> None:
    assert OpenFoodFacts("https://off.test", search_url="https://search.off.test").searchable
    assert not OpenFoodFacts("https://off.test").searchable
    # Без запроса по штрихкоду найденное нечем взять в каталог.
    assert not OpenFoodFacts("", search_url="https://search.off.test").searchable
