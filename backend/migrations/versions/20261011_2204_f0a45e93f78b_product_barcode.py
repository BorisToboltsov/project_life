"""product barcode

Revision ID: f0a45e93f78b
Revises: e8252b78ff95
Create Date: 2026-10-11 22:04:33.850644

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f0a45e93f78b"
down_revision: str | Sequence[str] | None = "e8252b78ff95"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Штрихкоды, которых не оказалось в Open Food Facts.
    op.create_table(
        "barcode_misses",
        sa.Column("barcode", sa.String(length=13), nullable=False),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("barcode", name=op.f("pk_barcode_misses")),
    )

    op.add_column("products", sa.Column("barcode", sa.String(length=13), nullable=True))
    op.create_check_constraint(
        op.f("ck_products_barcode"), "products", "barcode ~ '^([0-9]{8}|[0-9]{13})$'"
    )
    op.create_index(
        "uq_products_barcode",
        "products",
        ["barcode"],
        unique=True,
        postgresql_where=sa.text("barcode IS NOT NULL"),
    )

    # Всё, что есть в каталоге до этой миграции, внесли люди.
    op.add_column(
        "products",
        sa.Column(
            "source",
            sa.Enum("user", "open_food_facts", name="productsource", native_enum=False, length=16),
            server_default="user",
            nullable=False,
        ),
    )
    op.alter_column("products", "source", server_default=None)
    op.create_check_constraint(
        op.f("ck_products_source"), "products", "source IN ('user', 'open_food_facts')"
    )


def downgrade() -> None:
    # Прежняя схема не знает ни штрихкода, ни источника: продукты остаются, отметки теряются.
    op.drop_constraint(op.f("ck_products_source"), "products", type_="check")
    op.drop_column("products", "source")
    op.drop_index(
        "uq_products_barcode",
        table_name="products",
        postgresql_where=sa.text("barcode IS NOT NULL"),
    )
    op.drop_constraint(op.f("ck_products_barcode"), "products", type_="check")
    op.drop_column("products", "barcode")
    op.drop_table("barcode_misses")
