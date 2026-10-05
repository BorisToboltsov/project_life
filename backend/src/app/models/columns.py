"""Общие кирпичики колонок: перечисления как varchar с CHECK."""

from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum


def _values(enum: type[StrEnum]) -> list[str]:
    return [member.value for member in enum]


def choice(enum: type[StrEnum]) -> Enum:
    """Перечисление как varchar: добавить значение — миграция без ALTER TYPE."""
    return Enum(enum, native_enum=False, length=16, values_callable=_values)


def one_of(column: str, enum: type[StrEnum]) -> CheckConstraint:
    """CHECK для колонки-перечисления: база не примет значение мимо приложения."""
    allowed = ", ".join(f"'{value}'" for value in _values(enum))
    return CheckConstraint(f"{column} IN ({allowed})", name=column)
