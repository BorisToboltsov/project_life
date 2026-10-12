"""exercises

Revision ID: 042154997507
Revises: abc56e329469
Create Date: 2026-10-12 16:22:54.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "042154997507"
down_revision: str | Sequence[str] | None = "abc56e329469"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRESETS = (
    "elliptical",
    "treadmill_walk",
    "exercise_bike",
    "rowing_machine",
    "lat_pulldown",
    "dumbbell_bench_press",
    "seated_dumbbell_press",
    "rope_pushdown",
    "seated_front_raise",
    "ez_bar_curl",
    "crunch",
    "back_extension",
    "deadlift",
    "leg_press",
    "leg_extension",
    "lying_leg_curl",
    "plank",
    "goblet_squat",
    "lever_row",
    "lateral_overhead_raise",
    "hammer_curl",
    "kettlebell_swing",
    "russian_twist",
    "table_tennis",
    "barbell_squat",
    "bench_press",
    "pull_up",
    "push_up",
    "dip",
    "barbell_row",
    "overhead_press",
    "dumbbell_lunge",
    "romanian_deadlift",
    "calf_raise",
    "lateral_raise",
    "dumbbell_fly",
    "seated_cable_row",
    "french_press",
    "hanging_leg_raise",
    "glute_bridge",
)
KINDS = ("weight_reps", "reps", "time", "cardio")
MUSCLES = (
    "chest",
    "delts",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "traps",
    "lats",
    "lower_back",
    "glutes",
    "quads",
    "hamstrings",
    "calves",
)


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    # Список упражнений пользователя. Он начинается пустым: штатные упражнения человек
    # добавляет из справочника сам, строка заводится в момент добавления.
    op.create_table(
        "exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("preset", sa.String(length=32), nullable=True),
        sa.Column("name", sa.String(length=60), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column(
            "muscles",
            postgresql.ARRAY(sa.String(length=16)),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(f"preset IN ({_quoted(PRESETS)})", name=op.f("ck_exercises_preset")),
        sa.CheckConstraint(f"kind IN ({_quoted(KINDS)})", name=op.f("ck_exercises_kind")),
        sa.CheckConstraint(
            f"muscles <@ ARRAY[{_quoted(MUSCLES)}]::varchar[]", name=op.f("ck_exercises_muscles")
        ),
        sa.CheckConstraint(
            "preset IS NOT NULL OR name IS NOT NULL", name=op.f("ck_exercises_named")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_exercises_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_exercises")),
    )
    op.create_index(op.f("ix_exercises_user_id"), "exercises", ["user_id"], unique=False)
    op.create_index(
        "uq_exercises_user_preset",
        "exercises",
        ["user_id", "preset"],
        unique=True,
        postgresql_where=sa.text("preset IS NOT NULL"),
    )


def downgrade() -> None:
    # Прежняя схема упражнений не знает: списки пользователей теряются.
    op.drop_index(
        "uq_exercises_user_preset",
        table_name="exercises",
        postgresql_where=sa.text("preset IS NOT NULL"),
    )
    op.drop_index(op.f("ix_exercises_user_id"), table_name="exercises")
    op.drop_table("exercises")
