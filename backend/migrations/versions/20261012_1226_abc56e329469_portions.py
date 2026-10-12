"""portions

Revision ID: abc56e329469
Revises: 606fb64c3ae3
Create Date: 2026-10-12 12:26:00.307133

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "abc56e329469"
down_revision: str | Sequence[str] | None = "606fb64c3ae3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Размер порции и упаковки — в единицах продукта, как количество в записи.
SIZE = sa.Numeric(precision=6, scale=1)
PRODUCT_SIZES = ("serving_size", "package_size")


def upgrade() -> None:
    # У продуктов, заведённых до этой миграции, порции и упаковки нет.
    for size in PRODUCT_SIZES:
        op.add_column("products", sa.Column(size, SIZE, nullable=True))
    # Всё, что внесено раньше, внесено в единицах продукта.
    op.add_column("food_entries", sa.Column("portion_kind", sa.String(length=16), nullable=True))
    op.add_column("food_entries", sa.Column("portion_size", SIZE, nullable=True))
    op.add_column(
        "food_entries",
        sa.Column("portion_count", sa.Numeric(precision=5, scale=2), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_food_entries_portion_kind"),
        "food_entries",
        "portion_kind IN ('serving', 'package')",
    )
    op.create_check_constraint(
        op.f("ck_food_entries_portion"),
        "food_entries",
        "num_nonnulls(portion_kind, portion_size, portion_count) IN (0, 3)",
    )


def downgrade() -> None:
    # Прежняя схема порций не знает: записи остаются со своим количеством в единицах
    # продукта, теряется только то, что его внесли порциями.
    op.drop_constraint(op.f("ck_food_entries_portion"), "food_entries", type_="check")
    op.drop_constraint(op.f("ck_food_entries_portion_kind"), "food_entries", type_="check")
    for column in ("portion_count", "portion_size", "portion_kind"):
        op.drop_column("food_entries", column)
    for size in reversed(PRODUCT_SIZES):
        op.drop_column("products", size)
