"""workouts and sets

Revision ID: c42aa1126e81
Revises: 042154997507
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c42aa1126e81"
down_revision: str | Sequence[str] | None = "042154997507"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "exercises",
        sa.Column("rest_seconds", sa.Integer(), server_default=sa.text("'90'"), nullable=False),
    )
    op.create_check_constraint(
        "ck_exercises_rest_range", "exercises", "rest_seconds BETWEEN 0 AND 600"
    )
    op.create_table(
        "workouts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("repeated_from_id", sa.Uuid(), sa.ForeignKey("workouts.id", ondelete="SET NULL")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "uq_workouts_user_active",
        "workouts",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("finished_at IS NULL"),
    )
    op.create_index("ix_workouts_user_date", "workouts", ["user_id", "local_date"])
    op.create_table(
        "workout_exercises",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workout_id",
            sa.Uuid(),
            sa.ForeignKey("workouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("exercise_id", sa.Uuid(), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("workout_id", "exercise_id", name="uq_workout_exercises_workout_id"),
    )
    op.create_table(
        "workout_sets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workout_exercise_id",
            sa.Uuid(),
            sa.ForeignKey("workout_exercises.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("reps", sa.Integer()),
        sa.Column("weight_kg", sa.Numeric(9, 3)),
        sa.Column("weight_value", sa.Numeric(9, 3)),
        sa.Column("weight_unit", sa.String(2)),
        sa.Column("duration_seconds", sa.Integer()),
        sa.Column("distance_km", sa.Numeric(9, 3)),
        sa.Column("distance_value", sa.Numeric(9, 3)),
        sa.Column("distance_unit", sa.String(2)),
        sa.Column("incline_percent", sa.Numeric(5, 2)),
        sa.Column("level", sa.Integer()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('weight_reps', 'reps', 'time', 'cardio')", name="ck_workout_sets_kind"
        ),
        sa.CheckConstraint("reps IS NULL OR reps > 0", name="ck_workout_sets_positive_reps"),
        sa.CheckConstraint(
            "weight_kg IS NULL OR weight_kg >= 0", name="ck_workout_sets_positive_weight"
        ),
        sa.CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds > 0",
            name="ck_workout_sets_positive_duration",
        ),
        sa.CheckConstraint(
            "distance_km IS NULL OR distance_km > 0", name="ck_workout_sets_positive_distance"
        ),
        sa.CheckConstraint(
            "incline_percent IS NULL OR incline_percent BETWEEN 0 AND 100",
            name="ck_workout_sets_incline_range",
        ),
        sa.CheckConstraint("level IS NULL OR level > 0", name="ck_workout_sets_positive_level"),
        sa.CheckConstraint(
            "weight_unit IS NULL OR weight_unit IN ('kg', 'lb')", name="ck_workout_sets_weight_unit"
        ),
        sa.CheckConstraint(
            "distance_unit IS NULL OR distance_unit IN ('km', 'mi')",
            name="ck_workout_sets_distance_unit",
        ),
        sa.CheckConstraint(
            "(weight_value IS NULL) = (weight_unit IS NULL)", name="ck_workout_sets_weight_pair"
        ),
        sa.CheckConstraint(
            "(distance_value IS NULL) = (distance_unit IS NULL)",
            name="ck_workout_sets_distance_pair",
        ),
    )
    op.create_index("ix_workout_sets_item", "workout_sets", ["workout_exercise_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_workout_sets_item", table_name="workout_sets")
    op.drop_table("workout_sets")
    op.drop_table("workout_exercises")
    op.drop_index("ix_workouts_user_date", table_name="workouts")
    op.drop_index("uq_workouts_user_active", table_name="workouts")
    op.drop_table("workouts")
    op.drop_constraint("ck_exercises_rest_range", "exercises", type_="check")
    op.drop_column("exercises", "rest_seconds")
