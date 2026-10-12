"""water

Revision ID: 87f039dcbe74
Revises: 7d52e96644c4
Create Date: 2026-10-12 09:45:21.283469

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "87f039dcbe74"
down_revision: str | Sequence[str] | None = "7d52e96644c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Порции выпитой воды: выпитое за день — их сумма.
    op.create_table(
        "water_intakes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("amount_ml", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_water_intakes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_water_intakes")),
    )
    op.create_index(
        "ix_water_intakes_user_date", "water_intakes", ["user_id", "local_date"], unique=False
    )
    # У целей, заданных до этой миграции, цели по воде нет.
    op.add_column("nutrition_goals", sa.Column("water_ml", sa.Integer(), nullable=True))


def downgrade() -> None:
    # Прежняя схема воды не знает: порции и цель по воде теряются, остальные цели остаются.
    op.drop_column("nutrition_goals", "water_ml")
    op.drop_index("ix_water_intakes_user_date", table_name="water_intakes")
    op.drop_table("water_intakes")
