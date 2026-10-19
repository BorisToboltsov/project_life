from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid7

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.metrics import (
    CANONICAL_UNIT,
    CATALOG,
    STARTING_PRESETS,
    MetricPreset,
    Quantity,
    Source,
    Unit,
    limits,
    quantity_of,
    to_canonical,
)
from app.models.columns import choice, one_of

# До 999 999,999 — с запасом для любого показателя справочника.
VALUE = Numeric(9, 3)
METRIC_NAME = String(40)


class Metric(Base):
    """Вид замера в списке пользователя: штатный или свой, со своим названием.

    Убранный из списка вид не удаляется: внесённые по нему замеры остаются (ADR 0012).
    """

    __tablename__ = "metrics"
    __table_args__ = (
        one_of("preset", MetricPreset),
        one_of("quantity", Quantity),
        # У вида есть имя: код штатного или название, которое дал пользователь.
        CheckConstraint("preset IS NOT NULL OR name IS NOT NULL", name="named"),
        # Штатный вид у пользователя один: повторное добавление ничего не дублирует.
        Index(
            "uq_metrics_user_preset",
            "user_id",
            "preset",
            unique=True,
            postgresql_where=text("preset IS NOT NULL"),
        ),
    )

    # Ключ своего вида приходит от клиента (UUIDv7), штатного — выдаёт сервер.
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Код штатного вида: его название подбирает интерфейс на языке пользователя.
    preset: Mapped[MetricPreset | None] = mapped_column(choice(MetricPreset))
    name: Mapped[str | None] = mapped_column(METRIC_NAME)
    # Что измеряют; задаётся один раз — от этого зависит единица уже внесённых значений.
    quantity: Mapped[Quantity] = mapped_column(choice(Quantity))
    # Место в списке: меньше — раньше.
    position: Mapped[int]
    # Когда вид убрали из списка; пусто — он в списке.
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    @property
    def unit(self) -> Unit:
        """Каноническая единица, в которой хранятся значения."""
        return CANONICAL_UNIT[self.quantity]

    @property
    def limits(self) -> tuple[Decimal, Decimal]:
        """Допустимый диапазон в канонической единице."""
        return limits(self.preset, self.quantity)

    def accepts(self, value: Decimal, unit: Unit) -> bool:
        """Годится ли значение: единица той же величины, число в допустимом диапазоне.
        Давление одним числом не вносится: у показания своя запись (ADR 0022)."""
        if self.quantity == Quantity.PRESSURE:
            return False
        low, high = self.limits
        return quantity_of(unit) == self.quantity and low <= to_canonical(value, unit) <= high


def preset_metrics(user_id: UUID) -> list[Metric]:
    """Виды замеров, с которыми начинает каждый пользователь, в порядке списка."""
    return [
        Metric(
            id=uuid7(),
            user_id=user_id,
            preset=preset,
            quantity=CATALOG[preset].quantity,
            position=position,
        )
        for position, preset in enumerate(STARTING_PRESETS)
    ]


class Measurement(Base):
    """Одно измерение показателя: вес, обхват и всё, что позже ляжет в ту же таблицу."""

    __tablename__ = "measurements"
    __table_args__ = (
        # Давление в эту таблицу не попадает: показание лежит отдельно (ADR 0022).
        one_of("original_unit", Unit, exclude={Unit.MMHG}),
        one_of("source", Source),
        # История и график одного показателя пользователя за период.
        Index("ix_measurements_user_metric_date", "user_id", "metric_id", "local_date"),
    )

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Вид замера из списка пользователя.
    metric_id: Mapped[UUID] = mapped_column(ForeignKey("metrics.id", ondelete="CASCADE"))
    # Значение в канонической единице показателя — по нему строятся графики (ADR 0004).
    value: Mapped[Decimal] = mapped_column(VALUE)
    # Как ввёл пользователь: число и единица.
    original_value: Mapped[Decimal] = mapped_column(VALUE)
    original_unit: Mapped[Unit] = mapped_column(choice(Unit))
    measured_at: Mapped[datetime]
    # Календарный день пользователя в момент измерения; присылает клиент (ADR 0003).
    local_date: Mapped[date]
    source: Mapped[Source] = mapped_column(choice(Source), default=Source.MANUAL)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    @property
    def unit(self) -> Unit:
        """Каноническая единица, в которой хранится `value`: величина та же, что у
        единицы ввода."""
        return CANONICAL_UNIT[quantity_of(self.original_unit)]
