"""Бланки анализов, их значения и свои показатели пользователя (ADR 0022)."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.labs import LabPreset, LabUnit
from app.models.columns import choice, one_of

# До 999 999,9999 — с запасом для любого показателя бланка.
LAB_NUMBER = Numeric(10, 4)
LAB_NAME = String(60)
LAB_UNIT_TEXT = String(20)


class LabReport(Base):
    """Бланк анализа: дата забора, лаборатория и заметка. Значения лежат в `lab_values`."""

    __tablename__ = "lab_reports"
    __table_args__ = (Index("ix_lab_reports_user_date", "user_id", "local_date"),)

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # День забора; присылает клиент (ADR 0003).
    local_date: Mapped[date]
    lab: Mapped[str | None] = mapped_column(String(80))
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LabAnalyte(Base):
    """Свой показатель пользователя: название и единица текстом.

    Единица задаётся один раз — значения своего показателя не пересчитываются (инвариант
    I22). Убранный из списка показатель не удаляется: его значения остаются.
    """

    __tablename__ = "lab_analytes"

    # Ключ приходит от клиента (UUIDv7).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(LAB_NAME)
    unit: Mapped[str] = mapped_column(LAB_UNIT_TEXT)
    # Когда показатель убрали из списка; пусто — он в списке.
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LabValue(Base):
    """Значение одного показателя в бланке — как оно напечатано (инвариант I22).

    Отметка «вне референса» не хранится: её вычисляет интерфейс по числу и референсу.
    """

    __tablename__ = "lab_values"
    __table_args__ = (
        one_of("preset", LabPreset),
        one_of("original_unit", LabUnit),
        # Показатель — штатный по коду или свой по ключу, ровно один из двух.
        CheckConstraint("(preset IS NULL) <> (analyte_id IS NULL)", name="analyte"),
        # Единица бланка есть у штатного; у своего она записана в самом показателе.
        CheckConstraint("(preset IS NULL) = (original_unit IS NULL)", name="unit"),
        CheckConstraint("value >= 0 AND original_value >= 0", name="non_negative"),
        CheckConstraint(
            "(ref_low IS NULL OR ref_low >= 0) AND (ref_high IS NULL OR ref_high >= 0)"
            " AND (ref_low IS NULL OR ref_high IS NULL OR ref_low <= ref_high)",
            name="reference",
        ),
        # В бланке показатель встречается один раз.
        Index(
            "uq_lab_values_report_preset",
            "report_id",
            "preset",
            unique=True,
            postgresql_where=text("preset IS NOT NULL"),
        ),
        Index(
            "uq_lab_values_report_analyte",
            "report_id",
            "analyte_id",
            unique=True,
            postgresql_where=text("analyte_id IS NOT NULL"),
        ),
        # История своего показателя.
        Index("ix_lab_values_analyte", "analyte_id"),
    )

    # Ключ приходит от клиента (UUIDv7).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    report_id: Mapped[UUID] = mapped_column(ForeignKey("lab_reports.id", ondelete="CASCADE"))
    preset: Mapped[LabPreset | None] = mapped_column(choice(LabPreset, length=32))
    analyte_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("lab_analytes.id", ondelete="CASCADE")
    )
    # Для графика: у штатного — в канонической единице, у своего — как ввели.
    value: Mapped[Decimal] = mapped_column(LAB_NUMBER)
    # Как на бланке: число, единица и границы референса в той же единице.
    original_value: Mapped[Decimal] = mapped_column(LAB_NUMBER)
    original_unit: Mapped[LabUnit | None] = mapped_column(choice(LabUnit))
    ref_low: Mapped[Decimal | None] = mapped_column(LAB_NUMBER)
    ref_high: Mapped[Decimal | None] = mapped_column(LAB_NUMBER)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
