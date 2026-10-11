from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.columns import choice, one_of
from app.nutrition import Meal, Nutrients

# Состав на 100 г: энергия до 900,0 ккал, макронутриент до 100,00 г.
KCAL = Numeric(6, 1)
MACRO = Numeric(5, 2)
PRODUCT_NAME = String(120)


class Product(Base):
    """Продукт общего каталога: состав на 100 г. Виден всем, меняет автор или администратор."""

    __tablename__ = "products"

    # Ключ приходит от клиента (UUIDv7): повтор запроса не создаёт второй продукт (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(PRODUCT_NAME)
    kcal: Mapped[Decimal] = mapped_column(KCAL)
    protein_g: Mapped[Decimal] = mapped_column(MACRO)
    fat_g: Mapped[Decimal] = mapped_column(MACRO)
    carbs_g: Mapped[Decimal] = mapped_column(MACRO)
    # Автор; пусто, если его учётной записи больше нет, — тогда продукт правит администратор.
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class FoodEntry(Base):
    """Запись дневника питания: сколько граммов продукта съедено в приёме пищи."""

    __tablename__ = "food_entries"
    __table_args__ = (
        one_of("meal", Meal),
        # День дневника одного пользователя.
        Index("ix_food_entries_user_date", "user_id", "local_date"),
    )

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Календарный день пользователя, к которому относится запись (ADR 0003).
    local_date: Mapped[date]
    meal: Mapped[Meal] = mapped_column(choice(Meal))
    amount_g: Mapped[Decimal] = mapped_column(Numeric(6, 1))
    # Из какого продукта каталога запись; пусто, если продукт с тех пор удалили.
    product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    # Снимок продукта на момент внесения — название и состав на 100 г. Итоги считаются по
    # нему, а не по каталогу: правка продукта не меняет прошлые дни (инвариант I10).
    product_name: Mapped[str] = mapped_column(PRODUCT_NAME)
    kcal: Mapped[Decimal] = mapped_column(KCAL)
    protein_g: Mapped[Decimal] = mapped_column(MACRO)
    fat_g: Mapped[Decimal] = mapped_column(MACRO)
    carbs_g: Mapped[Decimal] = mapped_column(MACRO)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    @property
    def eaten(self) -> Nutrients:
        """Нутриенты съеденной порции — по снимку."""
        per_100g = Nutrients(self.kcal, self.protein_g, self.fat_g, self.carbs_g)
        return per_100g.portion(self.amount_g)


class NutritionGoal(Base):
    """Цель на день. Действует с `effective_from` до следующей цели: прошлые дни сверяются
    с той целью, что была у них."""

    __tablename__ = "nutrition_goals"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Календарный день пользователя, с которого цель действует (ADR 0003).
    effective_from: Mapped[date] = mapped_column(primary_key=True)
    kcal: Mapped[int]
    protein_g: Mapped[int]
    fat_g: Mapped[int]
    carbs_g: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
