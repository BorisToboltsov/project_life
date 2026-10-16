"""Именованные наборы упражнений и их календарное расписание."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class WorkoutGroup(Base):
    __tablename__ = "workout_groups"
    __table_args__ = (
        CheckConstraint("weekdays <@ ARRAY[0,1,2,3,4,5,6]", name="weekdays"),
        CheckConstraint("cardinality(weekdays) = 0 OR start_date IS NOT NULL", name="weekly_start"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_range"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    weekdays: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    start_date: Mapped[date | None]
    end_date: Mapped[date | None]
    dates: Mapped[list[date]] = mapped_column(ARRAY(Date))
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    def scheduled_on(self, day: date) -> bool:
        return day in self.dates or (
            self.start_date is not None
            and day >= self.start_date
            and (self.end_date is None or day <= self.end_date)
            and day.weekday() in self.weekdays
        )


class WorkoutGroupExercise(Base):
    __tablename__ = "workout_group_exercises"
    __table_args__ = (UniqueConstraint("group_id", "position"),)

    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("workout_groups.id", ondelete="CASCADE"), primary_key=True
    )
    exercise_id: Mapped[UUID] = mapped_column(ForeignKey("exercises.id"), primary_key=True)
    position: Mapped[int]
