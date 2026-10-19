"""lab results and blood pressure

Revision ID: 182d0f7c5c38
Revises: 5e1f0a7c9b24
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "182d0f7c5c38"
down_revision: str | Sequence[str] | None = "5e1f0a7c9b24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

METRIC_PRESETS = (
    "weight",
    "neck",
    "waist",
    "hips",
    "chest",
    "shoulders",
    "biceps",
    "forearm",
    "thigh",
    "calf",
    "body_fat",
)
QUANTITIES = ("mass", "length", "percent")

LAB_PRESETS = (
    "hemoglobin",
    "rbc",
    "hematocrit",
    "mcv",
    "mch",
    "mchc",
    "wbc",
    "neutrophils",
    "lymphocytes",
    "monocytes",
    "eosinophils",
    "basophils",
    "platelets",
    "esr",
    "glucose",
    "hba1c",
    "alt",
    "ast",
    "bilirubin_total",
    "creatinine",
    "urea",
    "uric_acid",
    "total_protein",
    "crp",
    "cholesterol_total",
    "ldl",
    "hdl",
    "triglycerides",
    "ferritin",
    "iron",
    "vitamin_d",
    "vitamin_b12",
    "folate",
    "tsh",
    "ft4",
    "ft3",
    "testosterone",
)
LAB_UNITS = (
    "g_l",
    "g_dl",
    "mmol_l",
    "mg_dl",
    "umol_l",
    "u_l",
    "percent",
    "e12_l",
    "e9_l",
    "fl",
    "pg",
    "mm_h",
    "mg_l",
    "ug_l",
    "ng_ml",
    "pg_ml",
    "pmol_l",
    "nmol_l",
    "uiu_ml",
    "miu_l",
    "ng_dl",
    "ug_dl",
)


def _in(values: Sequence[str]) -> str:
    return "IN (" + ", ".join(f"'{value}'" for value in values) + ")"


def _replace_metric_checks(presets: Sequence[str], quantities: Sequence[str]) -> None:
    op.drop_constraint(op.f("ck_metrics_preset"), "metrics", type_="check")
    op.create_check_constraint(op.f("ck_metrics_preset"), "metrics", f"preset {_in(presets)}")
    op.drop_constraint(op.f("ck_metrics_quantity"), "metrics", type_="check")
    op.create_check_constraint(
        op.f("ck_metrics_quantity"), "metrics", f"quantity {_in(quantities)}"
    )


def _timestamps() -> list[sa.Column[datetime]]:
    return [
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
    ]


def upgrade() -> None:
    # Давление — штатный вид замера своей величины (ADR 0022).
    _replace_metric_checks((*METRIC_PRESETS, "blood_pressure"), (*QUANTITIES, "pressure"))

    op.create_table(
        "blood_pressure_readings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("systolic", sa.SmallInteger(), nullable=False),
        sa.Column("diastolic", sa.SmallInteger(), nullable=False),
        sa.Column("pulse", sa.SmallInteger()),
        *_timestamps(),
        sa.CheckConstraint("systolic BETWEEN 50 AND 300", name="systolic_range"),
        sa.CheckConstraint("diastolic BETWEEN 25 AND 200", name="diastolic_range"),
        sa.CheckConstraint("systolic > diastolic", name="systolic_above_diastolic"),
        sa.CheckConstraint("pulse IS NULL OR pulse BETWEEN 20 AND 250", name="pulse_range"),
    )
    op.create_index(
        "ix_blood_pressure_readings_user_date",
        "blood_pressure_readings",
        ["user_id", "local_date"],
    )

    op.create_table(
        "lab_reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("lab", sa.String(80)),
        sa.Column("note", sa.String(500)),
        *_timestamps(),
    )
    op.create_index("ix_lab_reports_user_date", "lab_reports", ["user_id", "local_date"])

    op.create_table(
        "lab_analytes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        *_timestamps(),
    )
    op.create_index(op.f("ix_lab_analytes_user_id"), "lab_analytes", ["user_id"])

    op.create_table(
        "lab_values",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "report_id",
            sa.Uuid(),
            sa.ForeignKey("lab_reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("preset", sa.String(32)),
        sa.Column("analyte_id", sa.Uuid(), sa.ForeignKey("lab_analytes.id", ondelete="CASCADE")),
        sa.Column("value", sa.Numeric(10, 4), nullable=False),
        sa.Column("original_value", sa.Numeric(10, 4), nullable=False),
        sa.Column("original_unit", sa.String(16)),
        sa.Column("ref_low", sa.Numeric(10, 4)),
        sa.Column("ref_high", sa.Numeric(10, 4)),
        *_timestamps(),
        sa.CheckConstraint(f"preset {_in(LAB_PRESETS)}", name="preset"),
        sa.CheckConstraint(f"original_unit {_in(LAB_UNITS)}", name="original_unit"),
        sa.CheckConstraint("(preset IS NULL) <> (analyte_id IS NULL)", name="analyte"),
        sa.CheckConstraint("(preset IS NULL) = (original_unit IS NULL)", name="unit"),
        sa.CheckConstraint("value >= 0 AND original_value >= 0", name="non_negative"),
        sa.CheckConstraint(
            "(ref_low IS NULL OR ref_low >= 0) AND (ref_high IS NULL OR ref_high >= 0)"
            " AND (ref_low IS NULL OR ref_high IS NULL OR ref_low <= ref_high)",
            name="reference",
        ),
    )
    op.create_index(
        "uq_lab_values_report_preset",
        "lab_values",
        ["report_id", "preset"],
        unique=True,
        postgresql_where=sa.text("preset IS NOT NULL"),
    )
    op.create_index(
        "uq_lab_values_report_analyte",
        "lab_values",
        ["report_id", "analyte_id"],
        unique=True,
        postgresql_where=sa.text("analyte_id IS NOT NULL"),
    )
    op.create_index("ix_lab_values_analyte", "lab_values", ["analyte_id"])


def downgrade() -> None:
    op.drop_index("ix_lab_values_analyte", table_name="lab_values")
    op.drop_index("uq_lab_values_report_analyte", table_name="lab_values")
    op.drop_index("uq_lab_values_report_preset", table_name="lab_values")
    op.drop_table("lab_values")
    op.drop_index(op.f("ix_lab_analytes_user_id"), table_name="lab_analytes")
    op.drop_table("lab_analytes")
    op.drop_index("ix_lab_reports_user_date", table_name="lab_reports")
    op.drop_table("lab_reports")
    op.drop_index("ix_blood_pressure_readings_user_date", table_name="blood_pressure_readings")
    op.drop_table("blood_pressure_readings")
    # Прежняя схема не знает давления: вид уходит из списков вместе с показаниями выше.
    op.execute("DELETE FROM metrics WHERE preset = 'blood_pressure'")
    _replace_metric_checks(METRIC_PRESETS, QUANTITIES)
