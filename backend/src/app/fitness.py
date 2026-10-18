"""Справочник физических тестов (ADR 0021).

Что записывает тест и в каких пределах — задано здесь. Название, шаги протокола и оценку
по нормам подбирает интерфейс по коду теста.
"""

from decimal import Decimal
from enum import StrEnum


class FitnessTest(StrEnum):
    # Дистанция за 12 минут; по ней интерфейс считает VO2max.
    COOPER = "cooper"
    # Повторы до отказа; вариант — классические или с колен.
    PUSH_UPS = "push_ups"
    # Повторы до отказа прямым хватом из виса.
    PULL_UPS = "pull_ups"


class PushUpVariant(StrEnum):
    """Как отжимались. Задаётся у результата один раз: от него зависит, по какой таблице
    норм его оценивать."""

    CLASSIC = "classic"
    KNEE = "knee"


METERS_PER_MILE = Decimal("1609.344")

# Дистанция Купера в метрах: от быстрого шага до мирового рекорда с запасом.
COOPER_MIN_M = Decimal(600)
COOPER_MAX_M = Decimal(6000)

REPS_MAX = 1000


def to_meters(value: Decimal, unit: str) -> Decimal:
    """Дистанция в метрах — каноническая единица результата Купера (ADR 0004)."""
    return value * METERS_PER_MILE if unit == "mi" else value
