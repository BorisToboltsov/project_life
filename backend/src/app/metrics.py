"""Справочник показателей и пересчёт единиц (ADR 0004).

У каждой величины одна каноническая единица хранения; пересчёт из единицы, в которой
значение ввели, выполняется только здесь.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum


class Quantity(StrEnum):
    MASS = "mass"
    LENGTH = "length"


class Unit(StrEnum):
    KG = "kg"
    LB = "lb"
    CM = "cm"
    IN = "in"


class Metric(StrEnum):
    WEIGHT = "weight"
    NECK = "neck"
    WAIST = "waist"
    HIPS = "hips"


class Source(StrEnum):
    MANUAL = "manual"


CANONICAL_UNIT: dict[Quantity, Unit] = {Quantity.MASS: Unit.KG, Quantity.LENGTH: Unit.CM}

# Единица → её величина и множитель перевода в каноническую. Оба множителя точные по
# определению фунта и дюйма.
_UNITS: dict[Unit, tuple[Quantity, Decimal]] = {
    Unit.KG: (Quantity.MASS, Decimal(1)),
    Unit.LB: (Quantity.MASS, Decimal("0.45359237")),
    Unit.CM: (Quantity.LENGTH, Decimal(1)),
    Unit.IN: (Quantity.LENGTH, Decimal("2.54")),
}

# Точность хранения: грамм и сотая доля миллиметра с запасом — обратный пересчёт в фунты
# и дюймы возвращает введённое значение.
_PRECISION = Decimal("0.001")


@dataclass(frozen=True)
class MetricType:
    code: Metric
    quantity: Quantity
    # Допустимый диапазон в канонических единицах: отсекает опечатки, а не редкие случаи.
    min_value: Decimal
    max_value: Decimal

    @property
    def unit(self) -> Unit:
        return CANONICAL_UNIT[self.quantity]


CATALOG: dict[Metric, MetricType] = {
    metric_type.code: metric_type
    for metric_type in (
        MetricType(Metric.WEIGHT, Quantity.MASS, Decimal(2), Decimal(500)),
        MetricType(Metric.NECK, Quantity.LENGTH, Decimal(15), Decimal(80)),
        MetricType(Metric.WAIST, Quantity.LENGTH, Decimal(30), Decimal(250)),
        MetricType(Metric.HIPS, Quantity.LENGTH, Decimal(30), Decimal(250)),
    )
}


def quantity_of(unit: Unit) -> Quantity:
    return _UNITS[unit][0]


def to_canonical(value: Decimal, unit: Unit) -> Decimal:
    """Значение в единице `unit` → значение в канонической единице той же величины."""
    return (value * _UNITS[unit][1]).quantize(_PRECISION, rounding=ROUND_HALF_UP)
