"""fitness test results

Revision ID: 5e1f0a7c9b24
Revises: 3b520eb0fd07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5e1f0a7c9b24"
down_revision: str | Sequence[str] | None = "3b520eb0fd07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fitness_results",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("test", sa.String(16), nullable=False),
        sa.Column("tested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("reps", sa.Integer()),
        sa.Column("distance_m", sa.Numeric(9, 3)),
        sa.Column("distance_value", sa.Numeric(9, 3)),
        sa.Column("distance_unit", sa.String(2)),
        sa.Column("variant", sa.String(16)),
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
        sa.CheckConstraint("test IN ('cooper', 'push_ups', 'pull_ups')", name="test"),
        sa.CheckConstraint("variant IN ('classic', 'knee')", name="variant"),
        sa.CheckConstraint("(test = 'cooper') = (distance_m IS NOT NULL)", name="cooper_distance"),
        sa.CheckConstraint("(test = 'cooper') = (reps IS NULL)", name="reps"),
        sa.CheckConstraint(
            "(distance_m IS NULL) = (distance_value IS NULL)"
            " AND (distance_value IS NULL) = (distance_unit IS NULL)",
            name="distance_pair",
        ),
        sa.CheckConstraint(
            "distance_unit IS NULL OR distance_unit IN ('m', 'mi')", name="distance_unit"
        ),
        sa.CheckConstraint("distance_m IS NULL OR distance_m > 0", name="positive_distance"),
        sa.CheckConstraint("reps IS NULL OR reps > 0", name="positive_reps"),
        sa.CheckConstraint("(test = 'push_ups') = (variant IS NOT NULL)", name="push_up_variant"),
    )
    op.create_index(
        "ix_fitness_results_user_test_date",
        "fitness_results",
        ["user_id", "test", "local_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_fitness_results_user_test_date", table_name="fitness_results")
    op.drop_table("fitness_results")
