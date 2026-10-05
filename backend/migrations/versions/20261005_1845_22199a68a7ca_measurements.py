"""measurements

Revision ID: 22199a68a7ca
Revises: f28e0400fb4e
Create Date: 2026-10-05 18:45:52.096304

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "22199a68a7ca"
down_revision: str | Sequence[str] | None = "f28e0400fb4e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "measurements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "metric",
            sa.Enum("weight", "neck", "waist", "hips", name="metric", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("value", sa.Numeric(precision=9, scale=3), nullable=False),
        sa.Column("original_value", sa.Numeric(precision=9, scale=3), nullable=False),
        sa.Column(
            "original_unit",
            sa.Enum("kg", "lb", "cm", "in", name="unit", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column(
            "source", sa.Enum("manual", name="source", native_enum=False, length=16), nullable=False
        ),
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
            "metric IN ('weight', 'neck', 'waist', 'hips')", name=op.f("ck_measurements_metric")
        ),
        sa.CheckConstraint(
            "original_unit IN ('kg', 'lb', 'cm', 'in')", name=op.f("ck_measurements_original_unit")
        ),
        sa.CheckConstraint("source IN ('manual')", name=op.f("ck_measurements_source")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_measurements_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_measurements")),
    )
    op.create_index(
        "ix_measurements_user_metric_date",
        "measurements",
        ["user_id", "metric", "local_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_measurements_user_metric_date", table_name="measurements")
    op.drop_table("measurements")
