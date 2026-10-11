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
from app.models import (
    ErrorSource,
    FoodEntry,
    Language,
    Meal,
    Product,
    Role,
    Sex,
    UnitSystem,
    User,
)
from app.nutrition import MealPreset, Nutrients, ProductUnit, energy_kcal


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


# Отчёт об ошибке с клиента (инвариант I9). У каждого поля жёсткая форма: свободный текст —
# сообщение исключения, адрес страницы — в неё не укладывается.
ErrorKind = Annotated[str, StringConstraints(pattern=r"^[A-Za-z_$][A-Za-z0-9_$.]*$", max_length=80)]
# Шаблон маршрута: сегменты без цифр, параметр — `$имя`. Настоящий адрес с идентификатором
# записи сюда не пройдёт.
RouteTemplate = Annotated[
    str,
    StringConstraints(pattern=r"^/(\$?[A-Za-z_-]+(/\$?[A-Za-z_-]+)*)?$", max_length=120),
]
ScriptFile = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Za-z0-9_.@/-]+\.(js|mjs|jsx|ts|tsx)$", max_length=160),
]
FunctionName = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_$.<>]*$", max_length=80)]
AppVersion = Annotated[str, StringConstraints(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$", max_length=20)]
# Сборка фронтенда — одна длинная строка, поэтому номер колонки бывает очень большим.
Position = Annotated[int, Field(ge=0, le=1_000_000_000)]


class ErrorFrameIn(Strict):
    file: ScriptFile
    line: Position
    column: Position
    function: FunctionName = ""


class ErrorReportIn(Strict):
    kind: ErrorKind
    route: RouteTemplate | None = None
    frames: Annotated[list[ErrorFrameIn], Field(max_length=30)]
    version: AppVersion


class ErrorReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source: ErrorSource
    kind: str
    place: str | None
    stack: str
    version: str
    count: int
    first_seen: datetime
    last_seen: datetime


# Дневник начинается не раньше этой даты и не заглядывает дальше чем на год вперёд:
# границы отсекают опечатки в годе.
def _diary_date(value: date) -> date:
    latest = datetime.now(UTC).date() + timedelta(days=366)
    if not date(1900, 1, 1) <= value <= latest:
        raise ValueError("date out of range")
    return value


DiaryDate = Annotated[date, AfterValidator(_diary_date)]
ProductName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
MealName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
# Состав на 100 г или 100 мл. Энергии больше, чем в чистом жире, не бывает.
Kcal = Annotated[Decimal, Field(ge=0, le=900, max_digits=4, decimal_places=1)]
Macro = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
# Порция в единицах продукта: от грамма специй до пяти килограммов или литров — дальше
# опечатка.
Amount = Annotated[Decimal, Field(gt=0, le=5000, max_digits=5, decimal_places=1)]


class ProductIn(Strict):
    name: ProductName
    unit: ProductUnit
    # Состав на 100 единиц продукта.
    kcal: Kcal
    protein_g: Macro
    fat_g: Macro
    carbs_g: Macro

    @model_validator(mode="after")
    def _fits_in_100_grams(self) -> Self:
        if self.protein_g + self.fat_g + self.carbs_g > 100:
            raise ValueError("macronutrients exceed 100 g per 100 g")
        return self


class ProductOut(BaseModel):
    id: UUID
    name: str
    unit: ProductUnit
    kcal: float
    protein_g: float
    fat_g: float
    carbs_g: float
    # Может ли продукт менять тот, кто спрашивает: автор или администратор.
    editable: bool

    @classmethod
    def of(cls, product: Product, viewer: User) -> Self:
        return cls(
            id=product.id,
            name=product.name,
            unit=product.unit,
            kcal=float(product.kcal),
            protein_g=float(product.protein_g),
            fat_g=float(product.fat_g),
            carbs_g=float(product.carbs_g),
            editable=viewer.role == Role.ADMIN or product.created_by == viewer.id,
        )


class SuggestionOut(ProductOut):
    # Сколько этого продукта пользователь внёс в прошлый раз, в единицах продукта.
    amount: float


class SuggestionsOut(BaseModel):
    # Что чаще всего вносят в запрошенный приём пищи; без приёма в запросе — пусто.
    in_meal: list[SuggestionOut]
    recent: list[SuggestionOut]
    frequent: list[SuggestionOut]


class NutrientsOut(BaseModel):
    kcal: float
    protein_g: float
    fat_g: float
    carbs_g: float

    @classmethod
    def of(cls, nutrients: Nutrients) -> Self:
        return cls(
            kcal=float(nutrients.kcal),
            protein_g=float(nutrients.protein_g),
            fat_g=float(nutrients.fat_g),
            carbs_g=float(nutrients.carbs_g),
        )


class FoodEntryIn(Strict):
    local_date: DiaryDate
    # Приём пищи из своего списка.
    meal_id: UUID
    # Продукт каталога, с которого снимается состав. При правке записи тот же продукт
    # (или `null`) оставляет прежний снимок.
    product_id: UUID | None
    # Сколько съедено, в единицах продукта.
    amount: Amount


class FoodEntryOut(NutrientsOut):
    """Запись дневника; нутриенты — съеденной порции, по снимку продукта."""

    id: UUID
    local_date: date
    meal_id: UUID
    product_id: UUID | None
    product_name: str
    amount: float
    unit: ProductUnit

    @classmethod
    def of_entry(cls, entry: FoodEntry) -> Self:
        return cls(
            id=entry.id,
            local_date=entry.local_date,
            meal_id=entry.meal_id,
            product_id=entry.product_id,
            product_name=entry.product_name,
            amount=float(entry.amount),
            unit=entry.unit,
            **NutrientsOut.of(entry.eaten).model_dump(),
        )


GoalKcal = Annotated[int, Field(ge=500, le=10000)]
GoalMacro = Annotated[int, Field(ge=0, le=1000)]


class NutritionGoalIn(Strict):
    """Цель на день. `null` — цели по этому показателю нет; все четыре `null` снимают цель."""

    kcal: GoalKcal | None
    protein_g: GoalMacro | None
    fat_g: GoalMacro | None
    carbs_g: GoalMacro | None
    # Сегодняшний день пользователя: с него цель начинает действовать.
    local_date: date

    @model_validator(mode="after")
    def _starts_today(self) -> Self:
        # Местная дата расходится с датой по UTC не больше чем на сутки — в любом поясе.
        if abs((self.local_date - datetime.now(UTC).date()).days) > 1:
            raise ValueError("goal must start today")
        return self

    @model_validator(mode="after")
    def _macros_fit_in_kcal(self) -> Self:
        # Калории — бюджет: белки, жиры и углеводы не могут дать больше энергии.
        macros = energy_kcal(self.protein_g or 0, self.fat_g or 0, self.carbs_g or 0)
        if self.kcal is not None and macros > self.kcal:
            raise ValueError("macronutrients exceed the calorie goal")
        return self


class NutritionGoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kcal: int | None
    protein_g: int | None
    fat_g: int | None
    carbs_g: int | None
    effective_from: date

    def if_set(self) -> Self | None:
        """Снятая цель (все показатели пусты) — то же, что её отсутствие."""
        targets = (self.kcal, self.protein_g, self.fat_g, self.carbs_g)
        return None if all(target is None for target in targets) else self


class MealIn(Strict):
    name: MealName


class MealOut(BaseModel):
    """Приём пищи из списка пользователя."""

    id: UUID
    # Код предустановленного приёма: название подбирает интерфейс. У своего — `null`.
    preset: MealPreset | None
    # Название, которое дал пользователь; у предустановленного — `null`.
    name: str | None
    # Убран из списка: в дне остаётся, только пока в нём есть записи.
    archived: bool

    @classmethod
    def of(cls, meal: Meal) -> Self:
        return cls(
            id=meal.id, preset=meal.preset, name=meal.name, archived=meal.archived_at is not None
        )


class DayMealOut(MealOut):
    entries: list[FoodEntryOut]
    totals: NutrientsOut


class DiaryDayOut(BaseModel):
    local_date: date
    # Приёмы пищи из списка по порядку, включая пустые, и убранные — если в них есть записи.
    meals: list[DayMealOut]
    totals: NutrientsOut
    # Цель, действовавшая в этот день; `null` — цели тогда не было.
    goal: NutritionGoalOut | None


class CopyItem(Strict):
    source_id: UUID
    # Ключ копии выбирает клиент: повтор запроса не создаёт вторую копию (ADR 0002).
    id: RecordId


class DiaryCopyIn(Strict):
    to_date: DiaryDate
    # `null` — каждая запись остаётся в своём приёме пищи.
    to_meal_id: UUID | None = None
    items: Annotated[list[CopyItem], Field(min_length=1, max_length=200)]
