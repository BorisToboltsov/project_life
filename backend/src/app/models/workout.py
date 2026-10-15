"""Тренировка, выбранные упражнения и отдельные подходы."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.exercises import ExerciseKind
from app.models.columns import choice, one_of


class Workout(Base):
    __tablename__ = "workouts"
    __table_args__ = (
        Index(
            "uq_workouts_user_active",
            "user_id",
            unique=True,
            postgresql_where=text("finished_at IS NULL"),
        ),
        Index("ix_workouts_user_date", "user_id", "local_date"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    started_at: Mapped[datetime]
    local_date: Mapped[date]
    finished_at: Mapped[datetime | None]
    repeated_from_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("workouts.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"
    __table_args__ = (UniqueConstraint("workout_id", "exercise_id"),)

    id: Mapped[UUID] = mapped_column(primary_key=True)
    workout_id: Mapped[UUID] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"))
    exercise_id: Mapped[UUID] = mapped_column(ForeignKey("exercises.id"))
    position: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    __table_args__ = (
        one_of("kind", ExerciseKind),
        CheckConstraint("reps IS NULL OR reps > 0", name="positive_reps"),
        CheckConstraint("weight_kg IS NULL OR weight_kg >= 0", name="positive_weight"),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds > 0", name="positive_duration"
        ),
        CheckConstraint("distance_km IS NULL OR distance_km > 0", name="positive_distance"),
        CheckConstraint(
            "incline_percent IS NULL OR incline_percent BETWEEN 0 AND 100", name="incline_range"
        ),
        CheckConstraint("level IS NULL OR level > 0", name="positive_level"),
        CheckConstraint("weight_unit IS NULL OR weight_unit IN ('kg', 'lb')", name="weight_unit"),
        CheckConstraint(
            "distance_unit IS NULL OR distance_unit IN ('km', 'mi')", name="distance_unit"
        ),
        CheckConstraint("(weight_value IS NULL) = (weight_unit IS NULL)", name="weight_pair"),
        CheckConstraint("(distance_value IS NULL) = (distance_unit IS NULL)", name="distance_pair"),
        Index("ix_workout_sets_item", "workout_exercise_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    workout_exercise_id: Mapped[UUID] = mapped_column(
        ForeignKey("workout_exercises.id", ondelete="CASCADE")
    )
    kind: Mapped[ExerciseKind] = mapped_column(choice(ExerciseKind))
    reps: Mapped[int | None]
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    weight_value: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    weight_unit: Mapped[str | None] = mapped_column(String(2))
    duration_seconds: Mapped[int | None]
    distance_km: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    distance_value: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    distance_unit: Mapped[str | None] = mapped_column(String(2))
    incline_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    level: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
