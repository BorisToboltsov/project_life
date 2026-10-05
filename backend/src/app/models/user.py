from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid7

from sqlalchemy import CheckConstraint, Enum, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Role(StrEnum):
    USER = "user"
    ADMIN = "admin"


class Language(StrEnum):
    RU = "ru"
    EN = "en"


class UnitSystem(StrEnum):
    METRIC = "metric"
    IMPERIAL = "imperial"


class Sex(StrEnum):
    MALE = "male"
    FEMALE = "female"


def _values(enum: type[StrEnum]) -> list[str]:
    return [member.value for member in enum]


def choice(enum: type[StrEnum]) -> Enum:
    """Перечисление как varchar: добавить значение — миграция без ALTER TYPE."""
    return Enum(enum, native_enum=False, length=16, values_callable=_values)


def one_of(column: str, enum: type[StrEnum]) -> CheckConstraint:
    """CHECK для колонки-перечисления: база не примет значение мимо приложения."""
    allowed = ", ".join(f"'{value}'" for value in _values(enum))
    return CheckConstraint(f"{column} IN ({allowed})", name=column)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        one_of("role", Role),
        one_of("language", Language),
        one_of("unit_system", UnitSystem),
        one_of("sex", Sex),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    # Хранится в нижнем регистре — нормализует схема запроса.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[Role] = mapped_column(choice(Role))

    language: Mapped[Language] = mapped_column(choice(Language))
    timezone: Mapped[str] = mapped_column(String(64))
    unit_system: Mapped[UnitSystem] = mapped_column(choice(UnitSystem), default=UnitSystem.METRIC)
    sex: Mapped[Sex | None] = mapped_column(choice(Sex))
    birth_date: Mapped[date | None]
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))

    disclaimer_accepted_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
