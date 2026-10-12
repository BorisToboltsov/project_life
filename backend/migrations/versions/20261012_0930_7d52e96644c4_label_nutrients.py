"""label nutrients

Revision ID: 7d52e96644c4
Revises: f0a45e93f78b
Create Date: 2026-10-12 09:30:11.402716

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7d52e96644c4"
down_revision: str | Sequence[str] | None = "f0a45e93f78b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Что ещё печатают на этикетке, на 100 единиц продукта. В записи дневника — снимок.
TABLES = ("products", "food_entries")
NUTRIENTS = ("sugars_g", "saturated_fat_g", "fiber_g", "salt_g")


def upgrade() -> None:
    # У всего, что внесено до этой миграции, этих значений нет.
    for table in TABLES:
        for nutrient in NUTRIENTS:
            op.add_column(
                table, sa.Column(nutrient, sa.Numeric(precision=5, scale=2), nullable=True)
            )


def downgrade() -> None:
    # Прежняя схема этих значений не знает: продукты и записи остаются, значения теряются.
    for table in reversed(TABLES):
        for nutrient in reversed(NUTRIENTS):
            op.drop_column(table, nutrient)
