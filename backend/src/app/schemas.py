"""Схемы запросов и ответов API вместе с доменными ограничениями значений."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
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

from app import barcodes
from app.exercises import CardioField, ExerciseKind, ExercisePreset, ExerciseType, Muscle
from app.metrics import MetricPreset, Quantity, Unit, to_canonical
from app.models import (
    ErrorSource,
    Exercise,
    FoodEntry,
    Language,
    Meal,
    Metric,
    Product,
    Role,
    Sex,
    UnitSystem,
    User,
    WaterIntake,
    Workout,
    WorkoutSet,
)
from app.nutrition import (
    MAX_AMOUNT,
    MealPreset,
    Nutrients,
    PortionKind,
    ProductSource,
    ProductUnit,
    energy_kcal,
)
from app.services.open_food_facts import OffListing, OffProduct


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


MetricName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class MetricIn(Strict):
    """Свой вид замера. Величину задают один раз, при создании."""

    name: MetricName
    quantity: Quantity


class MetricPresetIn(Strict):
    preset: MetricPreset


class MetricOut(BaseModel):
    """Вид замера из списка пользователя."""

    id: UUID
    # Код штатного вида: название подбирает интерфейс. У своего — `null`.
    preset: MetricPreset | None
    # Название, которое дал пользователь; у штатного — `null`.
    name: str | None
    quantity: Quantity
    # Каноническая единица и допустимый диапазон в ней.
    unit: Unit
    min_value: float
    max_value: float
    # Убран из списка: замеры по нему остаются, но новых не вносят.
    archived: bool

    @classmethod
    def of(cls, metric: Metric) -> Self:
        low, high = metric.limits
        return cls(
            id=metric.id,
            preset=metric.preset,
            name=metric.name,
            quantity=metric.quantity,
            unit=metric.unit,
            min_value=float(low),
            max_value=float(high),
            archived=metric.archived_at is not None,
        )


class MetricListOut(BaseModel):
    # Весь список пользователя по порядку, вместе с убранными видами.
    metrics: list[MetricOut]
    # Штатные виды, которых в списке сейчас нет: их предлагает экран добавления.
    available: list[MetricPreset]


class MeasurementIn(Strict):
    # Вид замера из своего списка: подходит ли ему значение, проверяет эндпоинт.
    metric_id: UUID
    # Значение и единица — как ввёл пользователь; в каноническую пересчитывает сервер.
    value: Annotated[Decimal, Field(gt=0, max_digits=9, decimal_places=3)]
    unit: Unit
    measured_at: AwareDatetime
    local_date: date

    @property
    def canonical_value(self) -> Decimal:
        return to_canonical(self.value, self.unit)

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
    metric_id: UUID
    # В канонической единице показателя.
    value: float
    unit: Unit
    original_value: float
    original_unit: Unit
    measured_at: datetime
    local_date: date


class MetricSummary(BaseModel):
    """Последнее измерение показателя и предыдущее — для сравнения."""

    metric_id: UUID
    latest: MeasurementOut | None
    previous: MeasurementOut | None


ExerciseName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


def _distinct(muscles: list[Muscle]) -> list[Muscle]:
    """Каждая мышца — один раз, в том порядке, в каком её назвали."""
    return list(dict.fromkeys(muscles))


class ExerciseIn(Strict):
    """Своё упражнение. Что записывает подход, задают один раз, при создании."""

    name: ExerciseName
    kind: ExerciseKind
    muscles: Annotated[list[Muscle], Field(max_length=len(Muscle)), AfterValidator(_distinct)] = []


class ExercisePresetIn(Strict):
    preset: ExercisePreset


class ExerciseOut(BaseModel):
    """Упражнение из списка пользователя."""

    id: UUID
    # Код штатного упражнения: название подбирает интерфейс. У своего — `null`.
    preset: ExercisePreset | None
    # Название, которое дал пользователь; у штатного — `null`.
    name: str | None
    kind: ExerciseKind
    # Мышцы, которые делают основную работу, и те, что помогают.
    muscles: list[Muscle]
    secondary: list[Muscle]
    # Что, кроме времени, записывает подход кардио; у остальных видов — пусто.
    cardio_fields: list[CardioField]
    # Убрано из списка: записанное по нему остаётся, но новых подходов не вносят.
    archived: bool
    rest_seconds: int

    @classmethod
    def of(cls, exercise: Exercise) -> Self:
        return cls(
            id=exercise.id,
            preset=exercise.preset,
            name=exercise.name,
            kind=exercise.kind,
            muscles=list(exercise.muscles),
            secondary=list(exercise.secondary),
            cardio_fields=list(exercise.cardio_fields),
            archived=exercise.archived_at is not None,
            rest_seconds=exercise.rest_seconds,
        )


class PresetExerciseOut(BaseModel):
    """Штатное упражнение справочника."""

    preset: ExercisePreset
    kind: ExerciseKind
    muscles: list[Muscle]
    secondary: list[Muscle]
    cardio_fields: list[CardioField]

    @classmethod
    def of(cls, exercise: ExerciseType) -> Self:
        return cls(
            preset=exercise.code,
            kind=exercise.kind,
            muscles=list(exercise.muscles),
            secondary=list(exercise.secondary),
            cardio_fields=list(exercise.cardio_fields),
        )


class ExerciseListOut(BaseModel):
    # Весь список пользователя по порядку, вместе с убранными упражнениями.
    exercises: list[ExerciseOut]
    # Справочник целиком: экран показывает из него то, чего в списке нет.
    catalog: list[PresetExerciseOut]


class ExerciseRestIn(Strict):
    rest_seconds: Annotated[int, Field(ge=0, le=600)]


class WorkoutIn(Strict):
    started_at: AwareDatetime
    local_date: date

    @model_validator(mode="after")
    def _plausible_time(self) -> Self:
        if self.started_at > datetime.now(UTC) + timedelta(days=1):
            raise ValueError("workout from the future")
        if self.local_date < date(1900, 1, 1):
            raise ValueError("date out of range")
        if abs((self.local_date - self.started_at.astimezone(UTC).date()).days) > 1:
            raise ValueError("local date does not match workout time")
        return self


class WorkoutFinishIn(Strict):
    finished_at: AwareDatetime


class WorkoutRepeatIn(WorkoutIn):
    id: RecordId
    item_ids: list[RecordId]
    # Упражнение каждой строки, каким его видел клиент. Запуск, отложенный без сети, не
    # должен лечь на другой состав: подходы из очереди ссылаются на строки по порядку.
    exercise_ids: list[UUID] | None = None

    @model_validator(mode="after")
    def _distinct_items(self) -> Self:
        if len(set(self.item_ids)) != len(self.item_ids):
            raise ValueError("item ids must be distinct")
        if self.exercise_ids is not None and len(self.exercise_ids) != len(self.item_ids):
            raise ValueError("one exercise per item")
        return self


class WorkoutExerciseIn(Strict):
    exercise_id: UUID


class WorkoutSetIn(Strict):
    reps: Annotated[int, Field(ge=1, le=10000)] | None = None
    weight_value: (
        Annotated[Decimal, Field(ge=0, le=10000, max_digits=9, decimal_places=3)] | None
    ) = None
    weight_unit: Literal["kg", "lb"] | None = None
    duration_seconds: Annotated[int, Field(ge=1, le=86400)] | None = None
    distance_value: (
        Annotated[Decimal, Field(gt=0, le=10000, max_digits=9, decimal_places=3)] | None
    ) = None
    distance_unit: Literal["km", "mi"] | None = None
    incline_percent: (
        Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)] | None
    ) = None
    level: Annotated[int, Field(ge=1, le=100)] | None = None

    @model_validator(mode="after")
    def _paired_units(self) -> Self:
        if (self.weight_value is None) != (self.weight_unit is None):
            raise ValueError("weight and unit must be provided together")
        if (self.distance_value is None) != (self.distance_unit is None):
            raise ValueError("distance and unit must be provided together")
        return self


class WorkoutSetOut(BaseModel):
    id: UUID
    kind: ExerciseKind
    reps: int | None
    weight_kg: float | None
    weight_value: float | None
    weight_unit: str | None
    duration_seconds: int | None
    distance_km: float | None
    distance_value: float | None
    distance_unit: str | None
    incline_percent: float | None
    level: int | None

    @classmethod
    def of(cls, row: WorkoutSet) -> Self:
        return cls(
            id=row.id,
            kind=row.kind,
            reps=row.reps,
            weight_kg=float(row.weight_kg) if row.weight_kg is not None else None,
            weight_value=float(row.weight_value) if row.weight_value is not None else None,
            weight_unit=row.weight_unit,
            duration_seconds=row.duration_seconds,
            distance_km=float(row.distance_km) if row.distance_km is not None else None,
            distance_value=float(row.distance_value) if row.distance_value is not None else None,
            distance_unit=row.distance_unit,
            incline_percent=float(row.incline_percent) if row.incline_percent is not None else None,
            level=row.level,
        )


class WorkoutOut(BaseModel):
    id: UUID
    started_at: datetime
    local_date: date
    finished_at: datetime | None
    exercise_count: int
    set_count: int

    @classmethod
    def of(cls, row: Workout, exercise_count: int, set_count: int) -> Self:
        return cls(
            id=row.id,
            started_at=row.started_at,
            local_date=row.local_date,
            finished_at=row.finished_at,
            exercise_count=exercise_count,
            set_count=set_count,
        )


class WorkoutExerciseOut(BaseModel):
    id: UUID
    exercise: ExerciseOut
    position: int
    sets: list[WorkoutSetOut]
    previous: list[WorkoutSetOut]


class WorkoutDetailOut(WorkoutOut):
    exercises: list[WorkoutExerciseOut]


class WorkoutListOut(BaseModel):
    workouts: list[WorkoutOut]


class ExerciseLatestOut(BaseModel):
    """Подходы последней завершённой тренировки с этим упражнением."""

    exercise_id: UUID
    workout_id: UUID
    started_at: datetime
    sets: list[WorkoutSetOut]


class WorkoutRecentOut(BaseModel):
    """Копия журнала для работы без сети (ADR 0020)."""

    # Тренировки последних 14 дней по часовому поясу профиля и незавершённая — целиком.
    workouts: list[WorkoutDetailOut]
    # «В прошлый раз» для упражнения, которое добавят в тренировку без сети.
    latest: list[ExerciseLatestOut]


class ProgressPoint(BaseModel):
    workout_id: UUID
    local_date: date
    value: float


class ExerciseProgressOut(BaseModel):
    exercise_id: UUID
    kind: ExerciseKind
    # Единица графика — каноническая: kg, reps, seconds или km.
    metric: Literal["weight_kg", "reps", "duration_seconds", "distance_km"]
    points: list[ProgressPoint]
    max_weight_kg: float | None
    max_reps: int | None
    max_duration_seconds: int | None
    max_distance_km: float | None


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
# Количество в единицах продукта — съеденное, размер порции или упаковки.
Amount = Annotated[Decimal, Field(gt=0, le=MAX_AMOUNT, max_digits=5, decimal_places=1)]
# Сколько порций или упаковок: половина, полторы, но не больше ста — дальше опечатка.
PortionCount = Annotated[Decimal, Field(gt=0, le=100, max_digits=5, decimal_places=2)]


def _barcode(value: str) -> str:
    code = barcodes.normalize(value)
    if code is None:
        raise ValueError("not a product barcode")
    return code


# Штрихкод с упаковки: EAN-8, EAN-13 или UPC-A с верной контрольной цифрой. Дальше схемы он
# идёт в одном виде — см. `app.barcodes`.
Barcode = Annotated[str, StringConstraints(max_length=32), AfterValidator(_barcode)]


def _known(value: Decimal | None) -> float | None:
    return None if value is None else float(value)


class ProductIn(Strict):
    name: ProductName
    unit: ProductUnit
    # Состав на 100 единиц продукта.
    kcal: Kcal
    protein_g: Macro
    fat_g: Macro
    carbs_g: Macro
    # Что ещё печатают на этикетке; `null` — значения нет.
    sugars_g: Macro | None = None
    saturated_fat_g: Macro | None = None
    fiber_g: Macro | None = None
    salt_g: Macro | None = None
    # Сколько единиц продукта в его порции и в упаковке; `null` — такой меры у продукта нет.
    serving_size: Amount | None = None
    package_size: Amount | None = None
    # `null` — у продукта нет штрихкода.
    barcode: Barcode | None = None

    @model_validator(mode="after")
    def _fits_in_100_grams(self) -> Self:
        if self.protein_g + self.fat_g + self.carbs_g > 100:
            raise ValueError("macronutrients exceed 100 g per 100 g")
        return self

    @model_validator(mode="after")
    def _part_fits_in_the_whole(self) -> Self:
        # Сахара — часть углеводов, насыщенные жиры — часть жиров.
        if self.sugars_g is not None and self.sugars_g > self.carbs_g:
            raise ValueError("sugars exceed carbohydrates")
        if self.saturated_fat_g is not None and self.saturated_fat_g > self.fat_g:
            raise ValueError("saturated fat exceeds fat")
        return self


class IngredientIn(Strict):
    product_id: RecordId
    amount: Amount
    mass_g: Amount | None = None


class DishIn(Strict):
    name: ProductName
    ingredients: Annotated[list[IngredientIn], Field(min_length=1, max_length=100)]
    output_g: Amount
    serving_size: Amount | None = None


class IngredientOut(IngredientIn):
    snapshot: ProductIn


class RecipeOut(BaseModel):
    output_g: float
    ingredients: list[IngredientOut]


class ProductOut(BaseModel):
    recipe: RecipeOut | None = None
    id: UUID
    name: str
    unit: ProductUnit
    kcal: float
    protein_g: float
    fat_g: float
    carbs_g: float
    sugars_g: float | None
    saturated_fat_g: float | None
    fiber_g: float | None
    salt_g: float | None
    serving_size: float | None
    package_size: float | None
    barcode: str | None
    source: ProductSource
    # Может ли продукт менять тот, кто спрашивает: автор или администратор.
    editable: bool

    @classmethod
    def of(cls, product: Product, viewer: User) -> Self:
        return cls(
            recipe=RecipeOut.model_validate(product.recipe) if product.recipe else None,
            id=product.id,
            name=product.name,
            unit=product.unit,
            kcal=float(product.kcal),
            protein_g=float(product.protein_g),
            fat_g=float(product.fat_g),
            carbs_g=float(product.carbs_g),
            sugars_g=_known(product.sugars_g),
            saturated_fat_g=_known(product.saturated_fat_g),
            fiber_g=_known(product.fiber_g),
            salt_g=_known(product.salt_g),
            serving_size=_known(product.serving_size),
            package_size=_known(product.package_size),
            barcode=product.barcode,
            source=product.source,
            editable=viewer.role == Role.ADMIN or product.created_by == viewer.id,
        )


class BarcodeLookupIn(Strict):
    barcode: Barcode


class LookupStatus(StrEnum):
    """Чем кончился поиск по штрихкоду (ADR 0009)."""

    # Продукт есть в каталоге — был там или только что взят из Open Food Facts.
    FOUND = "found"
    # В Open Food Facts продукт есть, но состав неполный: его дополняет пользователь.
    DRAFT = "draft"
    NOT_FOUND = "not_found"
    # Open Food Facts не ответил; в своём каталоге продукта нет.
    UNAVAILABLE = "unavailable"


class ProductDraftOut(BaseModel):
    """Что известно о продукте, которого нет в каталоге: значения для формы создания.
    `null` — источник этого не знает."""

    name: str | None
    unit: ProductUnit
    kcal: float | None
    protein_g: float | None
    fat_g: float | None
    carbs_g: float | None
    sugars_g: float | None
    saturated_fat_g: float | None
    fiber_g: float | None
    salt_g: float | None
    serving_size: float | None
    package_size: float | None

    @classmethod
    def of(cls, found: OffProduct) -> Self:
        return cls(
            name=found.name,
            unit=found.unit,
            kcal=_known(found.kcal),
            protein_g=_known(found.protein_g),
            fat_g=_known(found.fat_g),
            carbs_g=_known(found.carbs_g),
            sugars_g=_known(found.sugars_g),
            saturated_fat_g=_known(found.saturated_fat_g),
            fiber_g=_known(found.fiber_g),
            salt_g=_known(found.salt_g),
            serving_size=_known(found.serving_size),
            package_size=_known(found.package_size),
        )


class BarcodeLookupOut(BaseModel):
    status: LookupStatus
    # Штрихкод в том виде, в каком он хранится в каталоге.
    barcode: str
    # Найденный продукт — при `found`.
    product: ProductOut | None = None
    # Заготовка продукта — при `draft`.
    draft: ProductDraftOut | None = None


class ExternalProductOut(BaseModel):
    """Продукт из Open Food Facts, которого нет в каталоге (ADR 0010). В каталог он
    попадает, когда его выберут, — поиском по этому штрихкоду."""

    barcode: str
    name: str
    unit: ProductUnit
    # Состав на 100 единиц; `null` — источник этого не знает.
    kcal: float | None
    protein_g: float | None
    fat_g: float | None
    carbs_g: float | None

    @classmethod
    def of(cls, listing: OffListing) -> Self:
        found = listing.product
        return cls(
            barcode=listing.barcode,
            name=listing.name,
            unit=found.unit,
            kcal=_known(found.kcal),
            protein_g=_known(found.protein_g),
            fat_g=_known(found.fat_g),
            carbs_g=_known(found.carbs_g),
        )


class ExternalSearchStatus(StrEnum):
    """Чем кончился поиск по названию в Open Food Facts (ADR 0010)."""

    OK = "ok"
    # Open Food Facts не ответил или исчерпан общий предел обращений к нему.
    UNAVAILABLE = "unavailable"


class ExternalSearchOut(BaseModel):
    status: ExternalSearchStatus
    items: list[ExternalProductOut]
    # Какую страницу спрашивать дальше; `null` — больше ничего нет.
    next_page: int | None


class PortionIn(Strict):
    """Количество порциями или упаковками продукта."""

    kind: PortionKind
    count: PortionCount


class PortionOut(BaseModel):
    kind: PortionKind
    # Сколько единиц продукта в одной порции или упаковке.
    size: float
    count: float

    @classmethod
    def of(
        cls, kind: PortionKind | None, size: Decimal | None, count: Decimal | None
    ) -> Self | None:
        """Порция записи или подсказки; чего-то из трёх нет — нет и порции."""
        if kind is None or size is None or count is None:
            return None
        return cls(kind=kind, size=float(size), count=float(count))


class SuggestionOut(ProductOut):
    # Сколько этого продукта пользователь внёс в прошлый раз, в единицах продукта.
    amount: float
    # Так же — порциями или упаковками, если в прошлый раз внесли ими и такая мера у
    # продукта ещё есть; размер — нынешний.
    portion: PortionOut | None


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
    # Сколько съедено: либо в единицах продукта, либо его порциями или упаковками — тогда
    # количество в единицах считает сервер.
    amount: Amount | None = None
    portion: PortionIn | None = None

    @model_validator(mode="after")
    def _says_how_much_one_way(self) -> Self:
        if (self.amount is None) == (self.portion is None):
            raise ValueError("either amount or portion")
        return self


class FoodEntryOut(NutrientsOut):
    """Запись дневника; нутриенты — съеденного, по снимку продукта."""

    id: UUID
    local_date: date
    meal_id: UUID
    product_id: UUID | None
    product_name: str
    amount: float
    unit: ProductUnit
    # Как количество внесли, если не в единицах продукта; размер — на момент внесения.
    portion: PortionOut | None

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
            portion=PortionOut.of(entry.portion_kind, entry.portion_size, entry.portion_count),
            **NutrientsOut.of(entry.eaten).model_dump(),
        )


# Порция воды в миллилитрах: от глотка до пяти литров — дальше опечатка.
WaterAmount = Annotated[int, Field(ge=1, le=5000)]


class WaterIntakeIn(Strict):
    local_date: DiaryDate
    amount_ml: WaterAmount


class WaterIntakeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    local_date: date
    amount_ml: int


class WaterDayOut(BaseModel):
    """Вода за день: порции в порядке внесения и их сумма."""

    total_ml: int
    intakes: list[WaterIntakeOut]

    @classmethod
    def of(cls, intakes: list[WaterIntake]) -> Self:
        return cls(
            total_ml=sum(intake.amount_ml for intake in intakes),
            intakes=[WaterIntakeOut.model_validate(intake) for intake in intakes],
        )


GoalKcal = Annotated[int, Field(ge=500, le=10000)]
GoalMacro = Annotated[int, Field(ge=0, le=1000)]
GoalWater = Annotated[int, Field(ge=100, le=10000)]


class NutritionGoalIn(Strict):
    """Цель на день. `null` — цели по этому показателю нет; все `null` снимают цель."""

    kcal: GoalKcal | None
    protein_g: GoalMacro | None
    fat_g: GoalMacro | None
    carbs_g: GoalMacro | None
    # Прежняя версия приложения о воде не знает и поле не присылает: тогда цель по воде
    # остаётся какой была (ADR 0011).
    water_ml: GoalWater | None = None
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
    water_ml: int | None
    effective_from: date

    def if_set(self) -> Self | None:
        """Снятая цель (все показатели пусты) — то же, что её отсутствие."""
        targets = (self.kcal, self.protein_g, self.fat_g, self.carbs_g, self.water_ml)
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
    water: WaterDayOut
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


class WorkoutGroupIn(Strict):
    name: ExerciseName
    exercise_ids: Annotated[list[UUID], Field(min_length=1, max_length=100)]
    weekdays: Annotated[list[Annotated[int, Field(ge=0, le=6)]], Field(max_length=7)] = []
    start_date: date | None = None
    end_date: date | None = None
    dates: Annotated[list[date], Field(max_length=366)] = []

    @model_validator(mode="after")
    def _valid_schedule(self) -> Self:
        for values in (self.exercise_ids, self.weekdays, self.dates):
            if len(values) != len(set(values)):
                raise ValueError("duplicate schedule or exercise")
        if self.weekdays and self.start_date is None:
            raise ValueError("weekly schedule needs start date")
        if self.end_date is not None and (
            self.start_date is None or self.end_date < self.start_date
        ):
            raise ValueError("invalid schedule range")
        return self


class WorkoutGroupOut(WorkoutGroupIn):
    id: UUID
    scheduled: bool


class WorkoutGroupListOut(BaseModel):
    date: date
    groups: list[WorkoutGroupOut]


StatisticsPeriod = Literal["week", "month"]
StatisticsDate = Annotated[date, Field(ge=date(1900, 1, 1), le=date(9998, 12, 31))]


class StatisticsAverage(BaseModel):
    value: float | None
    goal: float | None
    days: int
    goal_days: int


class StatisticsDay(BaseModel):
    local_date: date
    future: bool
    totals: NutrientsOut | None
    water_ml: int | None
    goal: NutritionGoalOut | None


class DiaryStatisticsOut(BaseModel):
    period: StatisticsPeriod
    start: date
    end: date
    today: date
    days: list[StatisticsDay]
    kcal: StatisticsAverage
    protein_g: StatisticsAverage
    fat_g: StatisticsAverage
    carbs_g: StatisticsAverage
    water_ml: StatisticsAverage
    first_weight: MeasurementOut | None
    last_weight: MeasurementOut | None
