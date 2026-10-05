from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.metrics import CATALOG, Metric, Source, Unit
from app.models.columns import choice, one_of

# До 999 999,999 — с запасом для любого показателя справочника.
VALUE = Numeric(9, 3)


class Measurement(Base):
    """Одно измерение показателя: вес, обхват и всё, что позже ляжет в ту же таблицу."""

    __tablename__ = "measurements"
    __table_args__ = (
        one_of("metric", Metric),
        one_of("original_unit", Unit),
        one_of("source", Source),
        # История и график одного показателя пользователя за период.
        Index("ix_measurements_user_metric_date", "user_id", "metric", "local_date"),
    )

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    metric: Mapped[Metric] = mapped_column(choice(Metric))
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
        """Каноническая единица, в которой хранится `value`."""
        return CATALOG[self.metric].unit
