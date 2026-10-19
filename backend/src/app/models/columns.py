"""Общие кирпичики колонок: перечисления как varchar с CHECK."""

from collections.abc import Collection
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum


def _values(enum: type[StrEnum], exclude: Collection[StrEnum] = ()) -> list[str]:
    return [member.value for member in enum if member not in exclude]


def choice(enum: type[StrEnum], length: int = 16) -> Enum:
    """Перечисление как varchar: добавить значение — миграция без ALTER TYPE."""
    return Enum(enum, native_enum=False, length=length, values_callable=_values)


def one_of(column: str, enum: type[StrEnum], exclude: Collection[StrEnum] = ()) -> CheckConstraint:
    """CHECK для колонки-перечисления: база не примет значение мимо приложения. `exclude` —
    значения перечисления, которых в этой колонке быть не может."""
    allowed = ", ".join(f"'{value}'" for value in _values(enum, exclude))
    return CheckConstraint(f"{column} IN ({allowed})", name=column)
