"""own metrics

Revision ID: 606fb64c3ae3
Revises: 87f039dcbe74
Create Date: 2026-10-12 10:43:22.250623

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "606fb64c3ae3"
down_revision: str | Sequence[str] | None = "87f039dcbe74"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Показатели, которые знала прежняя схема: с ними же начинает каждый пользователь.
STARTING = ("weight", "neck", "waist", "hips")
STARTING_IN = "IN ('weight', 'neck', 'waist', 'hips')"
PRESETS = (
    *STARTING,
    "chest",
    "shoulders",
    "biceps",
    "forearm",
    "thigh",
    "calf",
    "body_fat",
)
PRESET_IN = "IN (" + ", ".join(f"'{preset}'" for preset in PRESETS) + ")"
QUANTITIES = ("mass", "length", "percent")
QUANTITY_IN = "IN ('mass', 'length', 'percent')"
UNIT_IN = "IN ('kg', 'lb', 'cm', 'in', 'percent')"
UNIT_IN_BEFORE = "IN ('kg', 'lb', 'cm', 'in')"


def _replace_unit_check(allowed: str) -> None:
    op.drop_constraint(op.f("ck_measurements_original_unit"), "measurements", type_="check")
    op.create_check_constraint(
        op.f("ck_measurements_original_unit"), "measurements", f"original_unit {allowed}"
    )


def upgrade() -> None:
    op.create_table(
        "metrics",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "preset",
            sa.Enum(*PRESETS, name="metricpreset", native_enum=False, length=16),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=40), nullable=True),
        sa.Column(
            "quantity",
            sa.Enum(*QUANTITIES, name="quantity", native_enum=False, length=16),
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
        sa.CheckConstraint(f"preset {PRESET_IN}", name=op.f("ck_metrics_preset")),
        sa.CheckConstraint(f"quantity {QUANTITY_IN}", name=op.f("ck_metrics_quantity")),
        sa.CheckConstraint("preset IS NOT NULL OR name IS NOT NULL", name=op.f("ck_metrics_named")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_metrics_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_metrics")),
    )
    op.create_index(op.f("ix_metrics_user_id"), "metrics", ["user_id"], unique=False)
    op.create_index(
        "uq_metrics_user_preset",
        "metrics",
        ["user_id", "preset"],
        unique=True,
        postgresql_where=sa.text("preset IS NOT NULL"),
    )
    # У каждого, кто уже зарегистрирован, в списке те же четыре показателя, что были раньше.
    op.execute(
        """
        INSERT INTO metrics (id, user_id, preset, quantity, position)
        SELECT uuidv7(), users.id, presets.code, presets.quantity, presets.position
        FROM users
        CROSS JOIN (
            VALUES
                ('weight', 'mass', 0),
                ('neck', 'length', 1),
                ('waist', 'length', 2),
                ('hips', 'length', 3)
        ) AS presets (code, quantity, position)
        """
    )

    # Замер ссылается на вид из списка пользователя, а не называет показатель кодом.
    op.add_column("measurements", sa.Column("metric_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE measurements
        SET metric_id = metrics.id
        FROM metrics
        WHERE metrics.user_id = measurements.user_id AND metrics.preset = measurements.metric
        """
    )
    op.alter_column("measurements", "metric_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_measurements_metric_id_metrics"),
        "measurements",
        "metrics",
        ["metric_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_index("ix_measurements_user_metric_date", table_name="measurements")
    op.drop_constraint(op.f("ck_measurements_metric"), "measurements", type_="check")
    op.drop_column("measurements", "metric")
    op.create_index(
        "ix_measurements_user_metric_date",
        "measurements",
        ["user_id", "metric_id", "local_date"],
        unique=False,
    )

    # Свой показатель бывает и в процентах.
    _replace_unit_check(UNIT_IN)


def downgrade() -> None:
    # Прежняя схема знает четыре показателя: замеры остальных видов пропадают, а с ними —
    # все значения в процентах.
    op.execute(
        f"""
        DELETE FROM measurements
        USING metrics
        WHERE metrics.id = measurements.metric_id
            AND (metrics.preset IS NULL OR metrics.preset NOT {STARTING_IN})
        """  # noqa: S608 — список кодов задан в этом же файле
    )
    _replace_unit_check(UNIT_IN_BEFORE)

    op.add_column(
        "measurements",
        sa.Column(
            "metric", sa.Enum(*STARTING, name="metric", native_enum=False, length=16), nullable=True
        ),
    )
    op.execute(
        """
        UPDATE measurements
        SET metric = metrics.preset
        FROM metrics
        WHERE metrics.id = measurements.metric_id
        """
    )
    op.alter_column("measurements", "metric", nullable=False)
    op.create_check_constraint(
        op.f("ck_measurements_metric"), "measurements", f"metric {STARTING_IN}"
    )
    op.drop_index("ix_measurements_user_metric_date", table_name="measurements")
    op.drop_constraint(
        op.f("fk_measurements_metric_id_metrics"), "measurements", type_="foreignkey"
    )
    op.drop_column("measurements", "metric_id")
    op.create_index(
        "ix_measurements_user_metric_date",
        "measurements",
        ["user_id", "metric", "local_date"],
        unique=False,
    )

    op.drop_index("uq_metrics_user_preset", table_name="metrics")
    op.drop_index(op.f("ix_metrics_user_id"), table_name="metrics")
    op.drop_table("metrics")
