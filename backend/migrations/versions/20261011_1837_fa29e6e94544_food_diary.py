"""food diary

Revision ID: fa29e6e94544
Revises: 079bde43b233
Create Date: 2026-10-11 18:37:27.368281

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fa29e6e94544"
down_revision: str | Sequence[str] | None = "079bde43b233"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "nutrition_goals",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("kcal", sa.Integer(), nullable=False),
        sa.Column("protein_g", sa.Integer(), nullable=False),
        sa.Column("fat_g", sa.Integer(), nullable=False),
        sa.Column("carbs_g", sa.Integer(), nullable=False),
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
            name=op.f("fk_nutrition_goals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "effective_from", name=op.f("pk_nutrition_goals")),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kcal", sa.Numeric(precision=6, scale=1), nullable=False),
        sa.Column("protein_g", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("fat_g", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("carbs_g", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
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
            ["created_by"],
            ["users.id"],
            name=op.f("fk_products_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
    )
    op.create_table(
        "food_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column(
            "meal",
            sa.Enum(
                "breakfast", "lunch", "dinner", "snack", name="meal", native_enum=False, length=16
            ),
            nullable=False,
        ),
        sa.Column("amount_g", sa.Numeric(precision=6, scale=1), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("product_name", sa.String(length=120), nullable=False),
        sa.Column("kcal", sa.Numeric(precision=6, scale=1), nullable=False),
        sa.Column("protein_g", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("fat_g", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("carbs_g", sa.Numeric(precision=5, scale=2), nullable=False),
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
            "meal IN ('breakfast', 'lunch', 'dinner', 'snack')", name=op.f("ck_food_entries_meal")
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_food_entries_product_id_products"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_food_entries_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_food_entries")),
    )
    op.create_index(
        op.f("ix_food_entries_product_id"), "food_entries", ["product_id"], unique=False
    )
    op.create_index(
        "ix_food_entries_user_date", "food_entries", ["user_id", "local_date"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_food_entries_user_date", table_name="food_entries")
    op.drop_index(op.f("ix_food_entries_product_id"), table_name="food_entries")
    op.drop_table("food_entries")
    op.drop_table("products")
    op.drop_table("nutrition_goals")
