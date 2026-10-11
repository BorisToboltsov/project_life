"""Open Food Facts (ADR 0009): запрос продукта по штрихкоду и разбор ответа.

Наружу уходит только штрихкод и название приложения с версией (инвариант I11): запрос
одинаков, кто бы ни сканировал. Всё, что зависит от пользователя, — выбор названия на его
языке — происходит здесь, уже над ответом.
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from enum import Enum, auto
from functools import lru_cache
from typing import Any, cast
from uuid import UUID

import httpx

from app import __version__
from app.config import get_settings
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
# Сам сервис отвечает на 100 запросов продукта в минуту; держимся ниже.
OVERALL_LIMIT = 60
OVERALL_WINDOW = timedelta(minutes=1)
# Один человек не сканирует быстрее: больше — это сбой клиента, а не покупки.
USER_LIMIT = 60
USER_WINDOW = timedelta(minutes=10)

_KJ_PER_KCAL = Decimal("4.184")
_KCAL_STEP = Decimal("0.1")
_MACRO_STEP = Decimal("0.01")
_NAME_LENGTH = 120
# Единицы объёма, как их пишут на упаковке; всё остальное считается массой.
_VOLUME_UNITS = frozenset({"ml", "cl", "dl", "l", "мл", "л"})
_TRAILING_UNIT = re.compile(r"([^\W\d_]+)\.?\s*$")


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

    return OffProduct(
        name=_name(product, language),
        unit=_unit(product),
        kcal=_within(energy, 900, _KCAL_STEP),
        protein_g=protein,
        fat_g=fat,
        carbs_g=carbs,
    )


class OpenFoodFacts:
    """Клиент Open Food Facts с собственным ограничением частоты."""

    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._transport = transport
        self._overall = SlidingWindow(OVERALL_LIMIT, OVERALL_WINDOW)
        self._per_user = SlidingWindow(USER_LIMIT, USER_WINDOW)

    @property
    def enabled(self) -> bool:
        """Выключен, когда адрес не задан: штрихкод ищется только в своём каталоге."""
        return bool(self._base_url)

    def admits(self, user_id: UUID) -> bool:
        """Засчитывает пользователю обращение к источнику; `False` — его предел исчерпан."""
        return self._per_user.allow(user_id)

    async def product(self, barcode: str, language: Language) -> OffProduct | Miss:
        """Продукт по штрихкоду. `language` выбирает название из ответа и наружу не уходит."""
        if not self._overall.allow():
            return Miss.UNAVAILABLE
        try:
            async with (
                asyncio.timeout(TIMEOUT_SECONDS),
                httpx.AsyncClient(
                    base_url=self._base_url,
                    transport=self._transport,
                    headers={"User-Agent": USER_AGENT},
                ) as client,
            ):
                response = await client.get(f"/api/v2/product/{barcode}", params={"fields": FIELDS})
        except httpx.HTTPError, TimeoutError:
            return Miss.UNAVAILABLE
        try:
            payload = _object(response.json())
        except ValueError:
            return Miss.UNAVAILABLE
        if payload is None:
            return Miss.UNAVAILABLE
        # О неизвестном штрихкоде сервис говорит сам — полем `status`; ответ 404 без него
        # значит, что адрес ведёт не туда, и запоминать его как «не найдено» нельзя.
        if response.status_code in (200, 404) and payload.get("status") == 0:
            return Miss.NOT_FOUND
        product = _object(payload.get("product"))
        if response.status_code != 200 or payload.get("status") != 1 or product is None:
            return Miss.UNAVAILABLE
        return parse(product, language)


@lru_cache
def get_open_food_facts() -> OpenFoodFacts:
    return OpenFoodFacts(get_settings().off_url)
