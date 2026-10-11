"""meals units optional goal

Revision ID: e8252b78ff95
Revises: fa29e6e94544
Create Date: 2026-10-11 19:44:21.589239

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e8252b78ff95"
down_revision: str | Sequence[str] | None = "fa29e6e94544"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRESETS = ("breakfast", "lunch", "dinner", "snack")
PRESET_IN = "IN ('breakfast', 'lunch', 'dinner', 'snack')"
UNIT_IN = "IN ('g', 'ml')"
GOAL_TARGETS = ("kcal", "protein_g", "fat_g", "carbs_g")


def _unit() -> sa.Column[str]:
    # Всё, что внесено до этой миграции, измерялось в граммах.
    return sa.Column(
        "unit",
        sa.Enum("g", "ml", name="productunit", native_enum=False, length=16),
        server_default="g",
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "meals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "preset",
            sa.Enum(*PRESETS, name="mealpreset", native_enum=False, length=16),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=40), nullable=True),
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
        sa.CheckConstraint(f"preset {PRESET_IN}", name=op.f("ck_meals_preset")),
        sa.CheckConstraint("preset IS NOT NULL OR name IS NOT NULL", name=op.f("ck_meals_named")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_meals_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_meals")),
    )
    op.create_index(op.f("ix_meals_user_id"), "meals", ["user_id"], unique=False)
    op.create_index(
        "uq_meals_user_preset",
        "meals",
        ["user_id", "preset"],
        unique=True,
        postgresql_where=sa.text("preset IS NOT NULL"),
    )
    # У каждого, кто уже зарегистрирован, появляются те же четыре приёма, что были раньше.
    op.execute(
        """
        INSERT INTO meals (id, user_id, preset, position)
        SELECT uuidv7(), users.id, presets.code, presets.position
        FROM users
        CROSS JOIN (
            VALUES ('breakfast', 0), ('lunch', 1), ('dinner', 2), ('snack', 3)
        ) AS presets (code, position)
        """
    )

    # Запись дневника ссылается на приём пищи из списка, а не называет его кодом.
    op.add_column("food_entries", sa.Column("meal_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE food_entries
        SET meal_id = meals.id
        FROM meals
        WHERE meals.user_id = food_entries.user_id AND meals.preset = food_entries.meal
        """
    )
    op.alter_column("food_entries", "meal_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_food_entries_meal_id_meals"),
        "food_entries",
        "meals",
        ["meal_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_food_entries_meal_id"), "food_entries", ["meal_id"], unique=False)
    op.drop_constraint(op.f("ck_food_entries_meal"), "food_entries", type_="check")
    op.drop_column("food_entries", "meal")

    # Продукт измеряется в граммах или миллилитрах; запись хранит единицу в снимке.
    for table in ("products", "food_entries"):
        op.add_column(table, _unit())
        op.alter_column(table, "unit", server_default=None)
        op.create_check_constraint(op.f(f"ck_{table}_unit"), table, f"unit {UNIT_IN}")
    op.alter_column("food_entries", "amount_g", new_column_name="amount")

    # Цель можно задать не по всем показателям.
    for target in GOAL_TARGETS:
        op.alter_column("nutrition_goals", target, existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Прежняя схема не знает цели без одного из показателей: такие цели пропадают.
    op.execute(
        """
        DELETE FROM nutrition_goals
        WHERE kcal IS NULL OR protein_g IS NULL OR fat_g IS NULL OR carbs_g IS NULL
        """
    )
    for target in GOAL_TARGETS:
        op.alter_column("nutrition_goals", target, existing_type=sa.Integer(), nullable=False)

    # Миллилитры прежняя схема тоже не знает: количество остаётся числом, единица теряется.
    op.alter_column("food_entries", "amount", new_column_name="amount_g")
    for table in ("food_entries", "products"):
        op.drop_constraint(op.f(f"ck_{table}_unit"), table, type_="check")
        op.drop_column(table, "unit")

    op.add_column(
        "food_entries",
        sa.Column(
            "meal", sa.Enum(*PRESETS, name="meal", native_enum=False, length=16), nullable=True
        ),
    )
    # Записи своего приёма пищи уходят в перекус: другого места в прежней схеме им нет.
    op.execute(
        """
        UPDATE food_entries
        SET meal = COALESCE(meals.preset, 'snack')
        FROM meals
        WHERE meals.id = food_entries.meal_id
        """
    )
    op.alter_column("food_entries", "meal", nullable=False)
    op.create_check_constraint(op.f("ck_food_entries_meal"), "food_entries", f"meal {PRESET_IN}")
    op.drop_index(op.f("ix_food_entries_meal_id"), table_name="food_entries")
    op.drop_constraint(op.f("fk_food_entries_meal_id_meals"), "food_entries", type_="foreignkey")
    op.drop_column("food_entries", "meal_id")

    op.drop_index("uq_meals_user_preset", table_name="meals")
    op.drop_index(op.f("ix_meals_user_id"), table_name="meals")
    op.drop_table("meals")
