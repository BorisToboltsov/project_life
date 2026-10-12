"""Open Food Facts (ADR 0009, 0010): продукт по штрихкоду, продукты по названию и разбор
ответа.

Наружу уходит только штрихкод или текст поиска и название приложения с версией (инвариант
I11): запрос одинаков, кто бы ни спрашивал. Всё, что зависит от пользователя, — выбор
названия на его языке — происходит здесь, уже над ответом.
"""

import asyncio
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from enum import Enum, auto
from functools import lru_cache
from typing import Any, cast
from uuid import UUID

import httpx

from app import __version__, barcodes
from app.config import OFF_PRODUCTS_PER_MINUTE, OFF_SEARCHES_PER_MINUTE, get_settings
from app.models import Language
from app.nutrition import ProductUnit, energy_kcal
from app.services.rate_limit import SlidingWindow

# Сервис просит приложения называть себя и давать способ связаться.
USER_AGENT = f"project_life/{__version__} (https://github.com/BorisToboltsov/project_life)"
# Поля ответа, которые нужны для продукта каталога; названия — на всех языках приложения.
FIELDS = (
    "product_name,product_name_ru,product_name_en,brands,quantity,product_quantity_unit,nutriments"
)
# Дольше ждать нельзя: человек стоит с упаковкой в руке.
TIMEOUT_SECONDS = 4
# Окно общего предела на всё приложение; сами пределы — в настройках (`app.config`).
OVERALL_WINDOW = timedelta(minutes=1)
# Один человек не сканирует быстрее: больше — это сбой клиента, а не покупки.
USER_LIMIT = 60
USER_WINDOW = timedelta(minutes=10)

# Поиск по названию — отдельный сервис Open Food Facts (ADR 0010). Продукт в его ответе
# выглядит так же, как в ответе по штрихкоду, и несёт свой штрихкод.
SEARCH_FIELDS = f"code,{FIELDS}"
# Названия ищутся на всех языках приложения разом: запрос не зависит от того, кто ищет.
SEARCH_LANGS = ",".join(sorted(language.value for language in Language))
SEARCH_PAGE_SIZE = 20
# Дальше десяти тысяч результатов сервис не листает.
SEARCH_MAX_PAGE = 10_000 // SEARCH_PAGE_SIZE
# Короче этого текст наружу не уходит: по одной букве находится всё подряд.
SEARCH_MIN_LENGTH = 2
# Один человек не ищет чаще: каждая страница выдачи — отдельное обращение наружу.
SEARCH_USER_LIMIT = 30
SEARCH_USER_WINDOW = timedelta(minutes=10)
# Столько помнится страница: повтор того же поиска наружу не идёт.
SEARCH_TTL = timedelta(minutes=10)
SEARCH_REMEMBERED = 200

_KJ_PER_KCAL = Decimal("4.184")
_KCAL_STEP = Decimal("0.1")
_MACRO_STEP = Decimal("0.01")
_NAME_LENGTH = 120
# Единицы объёма, как их пишут на упаковке; всё остальное считается массой.
_VOLUME_UNITS = frozenset({"ml", "cl", "dl", "l", "мл", "л"})
_TRAILING_UNIT = re.compile(r"([^\W\d_]+)\.?\s*$")
# Всё, кроме букв, цифр и знаков внутри чисел («3,2 %»).
_NOT_SEARCHED = re.compile(r"[^\w%.,]+|_")


class Miss(Enum):
    """Продукта нет: источник его не знает или не ответил."""

    NOT_FOUND = auto()
    UNAVAILABLE = auto()


@dataclass(frozen=True)
class OffProduct:
    """Что источник знает о продукте, в мерках каталога: состав на 100 единиц. `None` —
    значения нет или оно невозможно."""

    name: str | None
    unit: ProductUnit
    kcal: Decimal | None
    protein_g: Decimal | None
    fat_g: Decimal | None
    carbs_g: Decimal | None
    # Что ещё печатают на этикетке: есть не у каждого продукта.
    sugars_g: Decimal | None = None
    saturated_fat_g: Decimal | None = None
    fiber_g: Decimal | None = None
    salt_g: Decimal | None = None


@dataclass(frozen=True)
class OffListing:
    """Продукт в выдаче поиска по названию: в каталог его берут по штрихкоду."""

    barcode: str
    name: str
    product: OffProduct


def _object(value: Any) -> dict[str, Any] | None:
    """Объект JSON; что угодно другое на его месте — всё равно что его нет."""
    return cast("dict[str, Any]", value) if isinstance(value, dict) else None


def _number(nutriments: dict[str, Any], key: str) -> Decimal | None:
    value = nutriments.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    try:
        number = Decimal(str(value).replace(",", "."))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _within(value: Decimal | None, limit: int, step: Decimal) -> Decimal | None:
    """Значение с точностью каталога; вне его диапазона — всё равно что неизвестное."""
    if value is None:
        return None
    rounded = value.quantize(step, rounding=ROUND_HALF_UP)
    return rounded if 0 <= rounded <= limit else None


def _part(value: Decimal | None, whole: Decimal | None) -> Decimal | None:
    """Часть целого: сахара — углеводов, насыщенные жиры — жиров. Часть больше целого —
    ошибка в источнике, а не состав: такое значение считается неизвестным."""
    return None if value is None or (whole is not None and value > whole) else value


def _text(product: dict[str, Any], key: str) -> str:
    value = product.get(key)
    return " ".join(value.split()) if isinstance(value, str) else ""


def _name(product: dict[str, Any], language: Language) -> str | None:
    """Название на языке пользователя, иначе на языке упаковки; марка — если её нет в нём."""
    name = next(
        (
            text
            for key in (f"product_name_{language.value}", "product_name", "product_name_en")
            if (text := _text(product, key))
        ),
        "",
    )
    if not name:
        return None
    brand = _text(product, "brands").split(",")[0].strip()
    if brand and brand.casefold() not in name.casefold():
        branded = f"{name}, {brand}"
        if len(branded) <= _NAME_LENGTH:
            return branded
    return name[:_NAME_LENGTH].rstrip()


def _unit(product: dict[str, Any]) -> ProductUnit:
    """Напиток измеряется в миллилитрах: так на упаковке записан объём."""
    unit = _text(product, "product_quantity_unit")
    if not unit:
        # «1 l», «0,5 л», «500ml» — единица стоит в конце строки.
        found = _TRAILING_UNIT.search(_text(product, "quantity"))
        unit = found.group(1) if found else ""
    return ProductUnit.ML if unit.casefold() in _VOLUME_UNITS else ProductUnit.G


def parse(product: dict[str, Any], language: Language) -> OffProduct:
    """Продукт из ответа Open Food Facts в мерках каталога."""
    nutriments = _object(product.get("nutriments")) or {}
    protein = _within(_number(nutriments, "proteins_100g"), 100, _MACRO_STEP)
    fat = _within(_number(nutriments, "fat_100g"), 100, _MACRO_STEP)
    carbs = _within(_number(nutriments, "carbohydrates_100g"), 100, _MACRO_STEP)

    energy = _number(nutriments, "energy-kcal_100g")
    if energy is None:
        # Энергия без пометки единицы в Open Food Facts записана в килоджоулях.
        joules = _number(nutriments, "energy-kj_100g") or _number(nutriments, "energy_100g")
        energy = joules / _KJ_PER_KCAL if joules is not None else None
    if energy is None and protein is not None and fat is not None and carbs is not None:
        # Как в форме продукта: калории, которых нет, считаются по белкам, жирам и углеводам.
        energy = energy_kcal(protein, fat, carbs)

    def label(key: str) -> Decimal | None:
        return _within(_number(nutriments, key), 100, _MACRO_STEP)

    return OffProduct(
        name=_name(product, language),
        unit=_unit(product),
        kcal=_within(energy, 900, _KCAL_STEP),
        protein_g=protein,
        fat_g=fat,
        carbs_g=carbs,
        sugars_g=_part(label("sugars_100g"), carbs),
        saturated_fat_g=_part(label("saturated-fat_100g"), fat),
        fiber_g=label("fiber_100g"),
        salt_g=label("salt_100g"),
    )


def search_terms(text: str) -> str:
    """Текст поиска в том виде, в каком он уходит наружу: слова и числа в нижнем регистре.

    Знаки убираются, чтобы текст не стал выражением на языке запросов сервиса; регистр —
    чтобы одинаковые поиски совпадали.
    """
    return " ".join(_NOT_SEARCHED.sub(" ", text.casefold()).split())


def _as_product(hit: dict[str, Any]) -> dict[str, Any]:
    """Продукт из выдачи поиска в том виде, в каком его отдаёт запрос по штрихкоду: марки
    там — строка через запятую, а здесь — список."""
    brands = hit.get("brands")
    if not isinstance(brands, list):
        return hit
    names = [brand for brand in cast("list[Any]", brands) if isinstance(brand, str)]
    return {**hit, "brands": ",".join(names)}


@dataclass(frozen=True)
class OffSearchPage:
    """Страница поиска по названию — продукты, как их отдал сервис: название каждому
    пользователю выбирается на его языке, уже над ответом."""

    hits: tuple[dict[str, Any], ...]
    has_more: bool

    def products(self, language: Language) -> list[OffListing]:
        """Продукты страницы, которые можно взять в каталог: с названием и со штрихкодом,
        какой каталог хранит."""
        listed: list[OffListing] = []
        for hit in self.hits:
            barcode = barcodes.normalize(_text(hit, "code"))
            product = parse(hit, language)
            if barcode is not None and product.name is not None:
                listed.append(OffListing(barcode, product.name, product))
        return listed


class OpenFoodFacts:
    """Клиент Open Food Facts с собственным ограничением частоты."""

    def __init__(
        self,
        base_url: str,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        search_url: str = "",
        products_per_minute: int = OFF_PRODUCTS_PER_MINUTE,
        searches_per_minute: int = OFF_SEARCHES_PER_MINUTE,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._search_url = search_url.rstrip("/")
        self._transport = transport
        self._overall = SlidingWindow(products_per_minute, OVERALL_WINDOW)
        self._per_user = SlidingWindow(USER_LIMIT, USER_WINDOW)
        self._search_overall = SlidingWindow(searches_per_minute, OVERALL_WINDOW)
        self._search_per_user = SlidingWindow(SEARCH_USER_LIMIT, SEARCH_USER_WINDOW)
        # Недавние страницы поиска и время, до которого каждая годится.
        self._pages: OrderedDict[tuple[str, int], tuple[float, OffSearchPage]] = OrderedDict()

    @property
    def enabled(self) -> bool:
        """Выключен, когда адрес не задан: штрихкод ищется только в своём каталоге."""
        return bool(self._base_url)

    @property
    def searchable(self) -> bool:
        """Ищет ли по названию. Без запроса по штрихкоду — нет: найденное нечем взять в
        каталог."""
        return self.enabled and bool(self._search_url)

    def admits(self, user_id: UUID) -> bool:
        """Засчитывает пользователю обращение к источнику; `False` — его предел исчерпан."""
        return self._per_user.allow(user_id)

    def admits_search(self, user_id: UUID) -> bool:
        """То же для поиска по названию: у него свой счёт."""
        return self._search_per_user.allow(user_id)

    async def _get(
        self, base_url: str, path: str, params: dict[str, str]
    ) -> tuple[int, dict[str, Any]] | None:
        """Ответ сервиса — код и объект JSON; `None` — не ответил или ответил не объектом."""
        try:
            async with (
                asyncio.timeout(TIMEOUT_SECONDS),
                httpx.AsyncClient(
                    base_url=base_url,
                    transport=self._transport,
                    headers={"User-Agent": USER_AGENT},
                ) as client,
            ):
                response = await client.get(path, params=params)
        except httpx.HTTPError, TimeoutError:
            return None
        try:
            payload = _object(response.json())
        except ValueError:
            return None
        return None if payload is None else (response.status_code, payload)

    async def product(self, barcode: str, language: Language) -> OffProduct | Miss:
        """Продукт по штрихкоду. `language` выбирает название из ответа и наружу не уходит."""
        if not self._overall.allow():
            return Miss.UNAVAILABLE
        answer = await self._get(self._base_url, f"/api/v2/product/{barcode}", {"fields": FIELDS})
        if answer is None:
            return Miss.UNAVAILABLE
        status_code, payload = answer
        # О неизвестном штрихкоде сервис говорит сам — полем `status`; ответ 404 без него
        # значит, что адрес ведёт не туда, и запоминать его как «не найдено» нельзя.
        if status_code in (200, 404) and payload.get("status") == 0:
            return Miss.NOT_FOUND
        product = _object(payload.get("product"))
        if status_code != 200 or payload.get("status") != 1 or product is None:
            return Miss.UNAVAILABLE
        return parse(product, language)

    def recalled(self, text: str, page: int) -> OffSearchPage | None:
        """Страница, которую недавно уже спрашивали: за ней наружу идти не нужно."""
        remembered = self._pages.get((text, page))
        if remembered is None or remembered[0] <= time.monotonic():
            return None
        return remembered[1]

    async def search(self, text: str, page: int) -> OffSearchPage | Miss:
        """Страница продуктов по названию. `text` — в том виде, какой даёт `search_terms`;
        язык пользователя наружу не уходит."""
        if not self._search_overall.allow():
            return Miss.UNAVAILABLE
        answer = await self._get(
            self._search_url,
            "/search",
            {
                "q": text,
                "langs": SEARCH_LANGS,
                "page_size": str(SEARCH_PAGE_SIZE),
                "page": str(page),
                "fields": SEARCH_FIELDS,
            },
        )
        if answer is None:
            return Miss.UNAVAILABLE
        status_code, payload = answer
        hits, pages = payload.get("hits"), payload.get("page_count")
        if status_code != 200 or not isinstance(hits, list):
            return Miss.UNAVAILABLE
        found = OffSearchPage(
            hits=tuple(
                _as_product(hit)
                for item in cast("list[Any]", hits)
                if (hit := _object(item)) is not None
            ),
            has_more=isinstance(pages, int) and page < min(pages, SEARCH_MAX_PAGE),
        )
        self._pages[text, page] = (time.monotonic() + SEARCH_TTL.total_seconds(), found)
        self._pages.move_to_end((text, page))
        while len(self._pages) > SEARCH_REMEMBERED:
            self._pages.popitem(last=False)
        return found


@lru_cache
def get_open_food_facts() -> OpenFoodFacts:
    settings = get_settings()
    return OpenFoodFacts(
        settings.off_url,
        search_url=settings.off_search_url,
        products_per_minute=settings.off_products_per_minute,
        searches_per_minute=settings.off_searches_per_minute,
    )
