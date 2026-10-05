"""Схемы запросов и ответов API вместе с доменными ограничениями значений."""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal, Self
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

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
