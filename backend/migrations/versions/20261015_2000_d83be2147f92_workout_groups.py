"""Группы тренировок и расписание.

Revision ID: d83be2147f92
Revises: c42aa1126e81
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d83be2147f92"
down_revision: str | Sequence[str] | None = "c42aa1126e81"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workout_groups",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("weekdays", postgresql.ARRAY(sa.Integer()), nullable=False),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("dates", postgresql.ARRAY(sa.Date()), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("weekdays <@ ARRAY[0,1,2,3,4,5,6]", name="weekdays"),
        sa.CheckConstraint(
            "cardinality(weekdays) = 0 OR start_date IS NOT NULL", name="weekly_start"
        ),
        sa.CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_range"),
    )
    op.create_index("ix_workout_groups_user_id", "workout_groups", ["user_id"])
    op.create_table(
        "workout_group_exercises",
        sa.Column(
            "group_id",
            sa.Uuid(),
            sa.ForeignKey("workout_groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("exercise_id", sa.Uuid(), sa.ForeignKey("exercises.id"), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("group_id", "position"),
    )
    op.add_column("workouts", sa.Column("source_group_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_workouts_source_group_id_workout_groups",
        "workouts",
        "workout_groups",
        ["source_group_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_workouts_source_group_id_workout_groups", "workouts", type_="foreignkey")
    op.drop_column("workouts", "source_group_id")
    op.drop_table("workout_group_exercises")
    op.drop_index("ix_workout_groups_user_id", table_name="workout_groups")
    op.drop_table("workout_groups")
