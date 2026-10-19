"""Показания давления (ADR 0022)."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.pressure import DIASTOLIC, PULSE, SYSTOLIC


class BloodPressureReading(Base):
    """Что показал тонометр — и ничего вычисленного: отметку «выше 135/85» и среднее за
    неделю считает интерфейс (инвариант I22). С видом замера показание не связано: убрав
    давление из списка, человек не теряет показаний."""

    __tablename__ = "blood_pressure_readings"
    __table_args__ = (
        CheckConstraint(f"systolic BETWEEN {SYSTOLIC[0]} AND {SYSTOLIC[1]}", name="systolic_range"),
        CheckConstraint(
            f"diastolic BETWEEN {DIASTOLIC[0]} AND {DIASTOLIC[1]}", name="diastolic_range"
        ),
        CheckConstraint("systolic > diastolic", name="systolic_above_diastolic"),
        CheckConstraint(
            f"pulse IS NULL OR pulse BETWEEN {PULSE[0]} AND {PULSE[1]}", name="pulse_range"
        ),
        Index("ix_blood_pressure_readings_user_date", "user_id", "local_date"),
    )

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    measured_at: Mapped[datetime]
    # Календарный день пользователя в момент измерения; присылает клиент (ADR 0003).
    local_date: Mapped[date]
    # Миллиметры ртутного столба и удары в минуту.
    systolic: Mapped[int] = mapped_column(SmallInteger)
    diastolic: Mapped[int] = mapped_column(SmallInteger)
    pulse: Mapped[int | None] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
