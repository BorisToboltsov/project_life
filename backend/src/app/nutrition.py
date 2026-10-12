"""Питание: приёмы пищи, единицы продукта и пересчёт состава в съеденное (ADR 0007, 0008).

Состав продукта задан на 100 г или на 100 мл. Сколько нутриентов в порции и сколько
энергии в белках, жирах и углеводах, считается только здесь.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum


class MealPreset(StrEnum):
    """Приёмы пищи, с которыми начинает каждый пользователь; название подбирает интерфейс."""

    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"


class ProductUnit(StrEnum):
    """В чём измеряется продукт: состав задан на 100 таких единиц, в них же вносится порция."""

    G = "g"
    ML = "ml"


class ProductSource(StrEnum):
    """Откуда продукт в каталоге: внесён человеком или взят из Open Food Facts (ADR 0009)."""

    USER = "user"
    OPEN_FOOD_FACTS = "open_food_facts"


class PortionKind(StrEnum):
    """Чем, кроме единиц продукта, вносят количество: его порцией или упаковкой (ADR 0013)."""

    SERVING = "serving"
    PACKAGE = "package"


# Больше за раз не вносят: от грамма специй до пяти килограммов или литров — дальше опечатка.
MAX_AMOUNT = Decimal(5000)
# Количество хранится с точностью до десятой доли единицы продукта.
_AMOUNT_STEP = Decimal("0.1")


def portions_amount(count: Decimal, size: Decimal) -> Decimal:
    """Сколько единиц продукта в `count` порциях или упаковках размера `size`."""
    return (count * size).quantize(_AMOUNT_STEP, rounding=ROUND_HALF_UP)


# Килокалорий в грамме белков, жиров и углеводов.
KCAL_PER_PROTEIN_G = 4
KCAL_PER_FAT_G = 9
KCAL_PER_CARBS_G = 4


def energy_kcal[Number: (int, Decimal)](
    protein_g: Number, fat_g: Number, carbs_g: Number
) -> Number:
    """Сколько энергии дают белки, жиры и углеводы."""
    return protein_g * KCAL_PER_PROTEIN_G + fat_g * KCAL_PER_FAT_G + carbs_g * KCAL_PER_CARBS_G


# Точность съеденного: сотая доля грамма и килокалории — суммы за день не копят ошибку.
_PRECISION = Decimal("0.01")


@dataclass(frozen=True)
class Nutrients:
    """Энергия в килокалориях; белки, жиры и углеводы в граммах."""

    kcal: Decimal = Decimal(0)
    protein_g: Decimal = Decimal(0)
    fat_g: Decimal = Decimal(0)
    carbs_g: Decimal = Decimal(0)

    def __add__(self, other: Nutrients) -> Nutrients:
        return Nutrients(
            self.kcal + other.kcal,
            self.protein_g + other.protein_g,
            self.fat_g + other.fat_g,
            self.carbs_g + other.carbs_g,
        )

    def portion(self, amount: Decimal) -> Nutrients:
        """Состав на 100 единиц продукта → состав порции в `amount` единиц."""

        def scaled(per_100: Decimal) -> Decimal:
            return (per_100 * amount / 100).quantize(_PRECISION, rounding=ROUND_HALF_UP)

        return Nutrients(
            scaled(self.kcal), scaled(self.protein_g), scaled(self.fat_g), scaled(self.carbs_g)
        )


def total(items: Iterable[Nutrients]) -> Nutrients:
    return sum(items, Nutrients())
