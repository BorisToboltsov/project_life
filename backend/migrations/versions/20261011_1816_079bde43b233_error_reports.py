"""error reports

Revision ID: 079bde43b233
Revises: 22199a68a7ca
Create Date: 2026-10-11 18:16:52.612362

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "079bde43b233"
down_revision: str | Sequence[str] | None = "22199a68a7ca"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "error_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "source",
            sa.Enum("backend", "frontend", name="errorsource", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=120), nullable=False),
        sa.Column("place", sa.String(length=160), nullable=True),
        sa.Column("stack", sa.Text(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column(
            "first_seen",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint(
            "source IN ('backend', 'frontend')", name=op.f("ck_error_reports_source")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_error_reports")),
        sa.UniqueConstraint("fingerprint", name=op.f("uq_error_reports_fingerprint")),
    )


def downgrade() -> None:
    op.drop_table("error_reports")
