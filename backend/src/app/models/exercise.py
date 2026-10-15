from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.exercises import CATALOG, CardioField, ExerciseKind, ExercisePreset, Muscle, cardio_fields
from app.models.columns import choice, one_of

EXERCISE_NAME = String(60)
# Код мышцы — как у колонок-перечислений.
_MUSCLE = String(16)


def _only_muscles(column: str) -> CheckConstraint:
    """CHECK для списка мышц: база не примет код мимо приложения."""
    allowed = ", ".join(f"'{muscle.value}'" for muscle in Muscle)
    return CheckConstraint(f"{column} <@ ARRAY[{allowed}]::varchar[]", name=column)


class Exercise(Base):
    """Упражнение в списке пользователя: штатное или своё, со своим названием.

    Убранное из списка упражнение не удаляется: записанные по нему подходы остаются
    (ADR 0014).
    """

    __tablename__ = "exercises"
    __table_args__ = (
        one_of("preset", ExercisePreset),
        one_of("kind", ExerciseKind),
        _only_muscles("muscles"),
        # У упражнения есть имя: код штатного или название, которое дал пользователь.
        CheckConstraint("preset IS NOT NULL OR name IS NOT NULL", name="named"),
        CheckConstraint("rest_seconds BETWEEN 0 AND 600", name="rest_range"),
        # Штатное упражнение у пользователя одно: повторное добавление ничего не дублирует.
        Index(
            "uq_exercises_user_preset",
            "user_id",
            "preset",
            unique=True,
            postgresql_where=text("preset IS NOT NULL"),
        ),
    )

    # Ключ своего упражнения приходит от клиента (UUIDv7), штатного — выдаёт сервер.
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Код штатного упражнения: его название подбирает интерфейс на языке пользователя.
    preset: Mapped[ExercisePreset | None] = mapped_column(choice(ExercisePreset, length=32))
    name: Mapped[str | None] = mapped_column(EXERCISE_NAME)
    # Что записывает подход; задаётся один раз — от этого зависит смысл уже записанного.
    kind: Mapped[ExerciseKind] = mapped_column(choice(ExerciseKind))
    # Мышцы своего упражнения; у штатного они заданы справочником.
    own_muscles: Mapped[list[str]] = mapped_column(
        "muscles", ARRAY(_MUSCLE), server_default=text("'{}'")
    )
    # Место в списке: меньше — раньше.
    position: Mapped[int]
    # Индивидуальная пауза между подходами; ноль выключает таймер.
    rest_seconds: Mapped[int] = mapped_column(server_default=text("'90'"))
    # Когда упражнение убрали из списка; пусто — оно в списке.
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    @property
    def muscles(self) -> tuple[Muscle, ...]:
        """Мышцы, которые делают основную работу."""
        if self.preset is None:
            return tuple(Muscle(code) for code in self.own_muscles)
        return CATALOG[self.preset].muscles

    @property
    def secondary(self) -> tuple[Muscle, ...]:
        """Мышцы, которые помогают; у своего упражнения их не различают."""
        return () if self.preset is None else CATALOG[self.preset].secondary

    @property
    def cardio_fields(self) -> tuple[CardioField, ...]:
        return cardio_fields(self.preset, self.kind)
