"""Результаты физических тестов (ADR 0021)."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.fitness import FitnessTest, PushUpVariant
from app.models.columns import choice, one_of

_COOPER = f"test = '{FitnessTest.COOPER.value}'"
_PUSH_UPS = f"test = '{FitnessTest.PUSH_UPS.value}'"


class FitnessResult(Base):
    """Что человек сделал в тесте — и ничего вычисленного: VO2max и оценку по нормам
    считает интерфейс (инвариант I21)."""

    __tablename__ = "fitness_results"
    __table_args__ = (
        one_of("test", FitnessTest),
        one_of("variant", PushUpVariant),
        # Купер — дистанция, остальные тесты — повторы.
        CheckConstraint(f"({_COOPER}) = (distance_m IS NOT NULL)", name="cooper_distance"),
        CheckConstraint(f"({_COOPER}) = (reps IS NULL)", name="reps"),
        CheckConstraint(
            "(distance_m IS NULL) = (distance_value IS NULL)"
            " AND (distance_value IS NULL) = (distance_unit IS NULL)",
            name="distance_pair",
        ),
        CheckConstraint(
            "distance_unit IS NULL OR distance_unit IN ('m', 'mi')", name="distance_unit"
        ),
        CheckConstraint("distance_m IS NULL OR distance_m > 0", name="positive_distance"),
        CheckConstraint("reps IS NULL OR reps > 0", name="positive_reps"),
        # Вариант есть только у отжиманий, и у них он обязателен.
        CheckConstraint(f"({_PUSH_UPS}) = (variant IS NOT NULL)", name="push_up_variant"),
        # История одного теста пользователя.
        Index("ix_fitness_results_user_test_date", "user_id", "test", "local_date"),
    )

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Какой тест; задаётся один раз — от него зависит смысл остальных полей.
    test: Mapped[FitnessTest] = mapped_column(choice(FitnessTest))
    tested_at: Mapped[datetime]
    # Календарный день пользователя в момент теста; присылает клиент (ADR 0003).
    local_date: Mapped[date]
    reps: Mapped[int | None]
    # Дистанция Купера в метрах и как её ввёл пользователь (ADR 0004).
    distance_m: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    distance_value: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    distance_unit: Mapped[str | None] = mapped_column(String(2))
    variant: Mapped[PushUpVariant | None] = mapped_column(choice(PushUpVariant))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
