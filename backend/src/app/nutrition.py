"""Питание: приёмы пищи и пересчёт состава продукта в съеденное (ADR 0007).

Состав продукта задан на 100 г. Сколько нутриентов в порции, считается только здесь.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum


class Meal(StrEnum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"


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

    def portion(self, amount_g: Decimal) -> Nutrients:
        """Состав на 100 г → состав порции массой `amount_g`."""

        def scaled(per_100g: Decimal) -> Decimal:
            return (per_100g * amount_g / 100).quantize(_PRECISION, rounding=ROUND_HALF_UP)

        return Nutrients(
            scaled(self.kcal), scaled(self.protein_g), scaled(self.fat_g), scaled(self.carbs_g)
        )


def total(items: Iterable[Nutrients]) -> Nutrients:
    return sum(items, Nutrients())
