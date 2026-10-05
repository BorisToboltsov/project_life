"""Схемы запросов и ответов API вместе с доменными ограничениями значений."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

from app.metrics import CATALOG, Metric, Quantity, Unit, quantity_of, to_canonical
from app.models import Language, Role, Sex, UnitSystem


def _known_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("unknown IANA time zone")
    return value


def _plausible_birth_date(value: date | None) -> date | None:
    # Сутки запаса: «сегодня» пользователя может опережать дату сервера по UTC.
    latest = datetime.now(UTC).date() + timedelta(days=1)
    if value is not None and not date(1900, 1, 1) <= value <= latest:
        raise ValueError("birth date out of range")
    return value


Email = Annotated[EmailStr, AfterValidator(str.lower)]
Password = Annotated[str, StringConstraints(min_length=10, max_length=128)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Timezone = Annotated[str, AfterValidator(_known_timezone)]
BirthDate = Annotated[date | None, AfterValidator(_plausible_birth_date)]
# От самого низкого до самого высокого человека в истории измерений, с запасом снизу.
HeightCm = Annotated[float, Field(ge=30, le=275)]
Token = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]


class Strict(BaseModel):
    """Тело запроса: неизвестное поле — ошибка, а не молча отброшенное значение."""

    model_config = ConfigDict(extra="forbid")


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: Role
    language: Language
    timezone: str
    unit_system: UnitSystem
    sex: Sex | None
    birth_date: date | None
    height_cm: float | None


class SessionOut(BaseModel):
    access_token: str
    expires_in: int
    user: UserOut


class LoginIn(Strict):
    email: Email
    password: Annotated[str, StringConstraints(max_length=128)]


class RegisterIn(Strict):
    token: Token
    email: Email
    password: Password
    display_name: DisplayName
    language: Language
    timezone: Timezone
    # Регистрация без согласия с дисклеймером невозможна.
    accept_disclaimer: Literal[True]


class TokenIn(Strict):
    token: Token


class InviteInfo(BaseModel):
    role: Role
    expires_at: datetime


class PasswordResetInfo(BaseModel):
    display_name: str
    expires_at: datetime


class PasswordChangeIn(Strict):
    current_password: Annotated[str, StringConstraints(max_length=128)]
    new_password: Password


class PasswordResetIn(Strict):
    token: Token
    new_password: Password


class ProfilePatch(Strict):
    """Меняются только присланные поля."""

    display_name: DisplayName | None = None
    language: Language | None = None
    timezone: Timezone | None = None
    unit_system: UnitSystem | None = None
    sex: Sex | None = None
    birth_date: BirthDate = None
    height_cm: HeightCm | None = None

    @model_validator(mode="after")
    def _required_fields_cannot_be_cleared(self) -> Self:
        for field in ("display_name", "language", "timezone", "unit_system"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: Role
    created_at: datetime


class InviteCreateIn(Strict):
    role: Role = Role.USER
    note: Note | None = None


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: Role
    note: str | None
    created_at: datetime
    expires_at: datetime


class InviteCreated(InviteOut):
    # Токен показывается один раз, при создании: в базе остаётся только его хэш.
    token: str


class PasswordResetCreated(BaseModel):
    token: str
    expires_at: datetime


def _version_7(value: UUID) -> UUID:
    if value.version != 7:
        raise ValueError("record id must be a UUID version 7")
    return value


# Ключ пользовательской записи выбирает клиент; принимается только UUIDv7 (ADR 0002).
RecordId = Annotated[UUID, AfterValidator(_version_7)]


class MetricTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: Metric
    quantity: Quantity
    # Каноническая единица и допустимый диапазон в ней.
    unit: Unit
    min_value: float
    max_value: float


class MeasurementIn(Strict):
    metric: Metric
    # Значение и единица — как ввёл пользователь; в каноническую пересчитывает сервер.
    value: Annotated[Decimal, Field(gt=0, max_digits=9, decimal_places=3)]
    unit: Unit
    measured_at: AwareDatetime
    local_date: date

    @property
    def canonical_value(self) -> Decimal:
        return to_canonical(self.value, self.unit)

    @model_validator(mode="after")
    def _fits_the_metric(self) -> Self:
        metric_type = CATALOG[self.metric]
        if quantity_of(self.unit) != metric_type.quantity:
            raise ValueError("unit does not measure this metric")
        if not metric_type.min_value <= self.canonical_value <= metric_type.max_value:
            raise ValueError("value out of range for this metric")
        return self

    @model_validator(mode="after")
    def _plausible_time(self) -> Self:
        now = datetime.now(UTC)
        if self.measured_at > now + timedelta(days=1):
            raise ValueError("measurement from the future")
        if self.local_date < date(1900, 1, 1):
            raise ValueError("date out of range")
        # Местная дата расходится с датой по UTC не больше чем на сутки — в любом поясе.
        if abs((self.local_date - self.measured_at.astimezone(UTC).date()).days) > 1:
            raise ValueError("local date does not match the moment of measurement")
        return self


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    metric: Metric
    # В канонической единице показателя.
    value: float
    unit: Unit
    original_value: float
    original_unit: Unit
    measured_at: datetime
    local_date: date


class MetricSummary(BaseModel):
    """Последнее измерение показателя и предыдущее — для сравнения."""

    metric: Metric
    latest: MeasurementOut | None
    previous: MeasurementOut | None
