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
    PERCENT = "percent"
    # Давление: показание — верхнее, нижнее и пульс — лежит отдельной записью (ADR 0022).
    PRESSURE = "pressure"


class Unit(StrEnum):
    KG = "kg"
    LB = "lb"
    CM = "cm"
    IN = "in"
    PERCENT = "percent"
    MMHG = "mmhg"


class MetricPreset(StrEnum):
    """Штатные показатели: название и подсказку «как измерять» подбирает интерфейс."""

    WEIGHT = "weight"
    NECK = "neck"
    WAIST = "waist"
    HIPS = "hips"
    CHEST = "chest"
    SHOULDERS = "shoulders"
    BICEPS = "biceps"
    FOREARM = "forearm"
    THIGH = "thigh"
    CALF = "calf"
    BODY_FAT = "body_fat"
    BLOOD_PRESSURE = "blood_pressure"


class Source(StrEnum):
    MANUAL = "manual"


CANONICAL_UNIT: dict[Quantity, Unit] = {
    Quantity.MASS: Unit.KG,
    Quantity.LENGTH: Unit.CM,
    Quantity.PERCENT: Unit.PERCENT,
    Quantity.PRESSURE: Unit.MMHG,
}

# Единица → её величина и множитель перевода в каноническую. Множители фунта и дюйма
# точные по определению.
_UNITS: dict[Unit, tuple[Quantity, Decimal]] = {
    Unit.KG: (Quantity.MASS, Decimal(1)),
    Unit.LB: (Quantity.MASS, Decimal("0.45359237")),
    Unit.CM: (Quantity.LENGTH, Decimal(1)),
    Unit.IN: (Quantity.LENGTH, Decimal("2.54")),
    Unit.PERCENT: (Quantity.PERCENT, Decimal(1)),
    Unit.MMHG: (Quantity.PRESSURE, Decimal(1)),
}

# Точность хранения: грамм и сотая доля миллиметра с запасом — обратный пересчёт в фунты
# и дюймы возвращает введённое значение.
_PRECISION = Decimal("0.001")


@dataclass(frozen=True)
class MetricType:
    code: MetricPreset
    quantity: Quantity
    # Допустимый диапазон в канонических единицах: отсекает опечатки, а не редкие случаи.
    min_value: Decimal
    max_value: Decimal


CATALOG: dict[MetricPreset, MetricType] = {
    metric_type.code: metric_type
    for metric_type in (
        MetricType(MetricPreset.WEIGHT, Quantity.MASS, Decimal(2), Decimal(500)),
        MetricType(MetricPreset.NECK, Quantity.LENGTH, Decimal(15), Decimal(80)),
        MetricType(MetricPreset.WAIST, Quantity.LENGTH, Decimal(30), Decimal(250)),
        MetricType(MetricPreset.HIPS, Quantity.LENGTH, Decimal(30), Decimal(250)),
        MetricType(MetricPreset.CHEST, Quantity.LENGTH, Decimal(40), Decimal(250)),
        MetricType(MetricPreset.SHOULDERS, Quantity.LENGTH, Decimal(50), Decimal(250)),
        MetricType(MetricPreset.BICEPS, Quantity.LENGTH, Decimal(10), Decimal(100)),
        MetricType(MetricPreset.FOREARM, Quantity.LENGTH, Decimal(10), Decimal(80)),
        MetricType(MetricPreset.THIGH, Quantity.LENGTH, Decimal(20), Decimal(150)),
        MetricType(MetricPreset.CALF, Quantity.LENGTH, Decimal(15), Decimal(100)),
        MetricType(MetricPreset.BODY_FAT, Quantity.PERCENT, Decimal(1), Decimal(75)),
        # Пределы верхнего давления; показание проверяет свой эндпоинт (ADR 0022).
        MetricType(MetricPreset.BLOOD_PRESSURE, Quantity.PRESSURE, Decimal(50), Decimal(300)),
    )
}

# С этими показателями начинает каждый пользователь; остальные он добавляет сам.
STARTING_PRESETS: tuple[MetricPreset, ...] = (
    MetricPreset.WEIGHT,
    MetricPreset.NECK,
    MetricPreset.WAIST,
    MetricPreset.HIPS,
)

# Что может измерять свой вид замера. Давление — только штатный вид: у его показания своя
# запись (ADR 0022).
OWN_QUANTITIES: tuple[Quantity, ...] = (Quantity.MASS, Quantity.LENGTH, Quantity.PERCENT)

# Свой показатель: что именно измеряют, приложение не знает, поэтому диапазон — общий для
# величины.
_OWN_LIMITS: dict[Quantity, tuple[Decimal, Decimal]] = {
    Quantity.MASS: (Decimal("0.1"), Decimal(500)),
    Quantity.LENGTH: (Decimal("0.1"), Decimal(300)),
    Quantity.PERCENT: (Decimal("0.1"), Decimal(100)),
}


def limits(preset: MetricPreset | None, quantity: Quantity) -> tuple[Decimal, Decimal]:
    """Допустимый диапазон показателя в канонической единице: у штатного — свой."""
    if preset is None:
        return _OWN_LIMITS[quantity]
    metric_type = CATALOG[preset]
    return metric_type.min_value, metric_type.max_value


def quantity_of(unit: Unit) -> Quantity:
    return _UNITS[unit][0]


def to_canonical(value: Decimal, unit: Unit) -> Decimal:
    """Значение в единице `unit` → значение в канонической единице той же величины."""
    return (value * _UNITS[unit][1]).quantize(_PRECISION, rounding=ROUND_HALF_UP)
