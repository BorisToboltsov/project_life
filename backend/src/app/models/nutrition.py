from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid7

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.columns import choice, one_of
from app.nutrition import MealPreset, Nutrients, ProductSource, ProductUnit

# Состав на 100 г или 100 мл: энергия до 900,0 ккал, макронутриент до 100,00 г.
KCAL = Numeric(6, 1)
MACRO = Numeric(5, 2)
PRODUCT_NAME = String(120)
MEAL_NAME = String(40)
# EAN-8 или EAN-13 — в том виде, к которому штрихкод приводит `app.barcodes`.
BARCODE = String(13)


class Product(Base):
    """Продукт общего каталога: состав на 100 г или на 100 мл. Виден всем, меняет автор или
    администратор."""

    __tablename__ = "products"
    __table_args__ = (
        one_of("unit", ProductUnit),
        one_of("source", ProductSource),
        CheckConstraint("barcode ~ '^([0-9]{8}|[0-9]{13})$'", name="barcode"),
        # Один штрихкод — один продукт: сканирование отвечает однозначно (ADR 0009).
        Index(
            "uq_products_barcode",
            "barcode",
            unique=True,
            postgresql_where=text("barcode IS NOT NULL"),
        ),
    )

    # Ключ приходит от клиента (UUIDv7): повтор запроса не создаёт второй продукт (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(PRODUCT_NAME)
    # В чём измеряется продукт: состав ниже — на 100 таких единиц.
    unit: Mapped[ProductUnit] = mapped_column(choice(ProductUnit))
    kcal: Mapped[Decimal] = mapped_column(KCAL)
    protein_g: Mapped[Decimal] = mapped_column(MACRO)
    fat_g: Mapped[Decimal] = mapped_column(MACRO)
    carbs_g: Mapped[Decimal] = mapped_column(MACRO)
    # Что ещё печатают на этикетке; пусто — на упаковке этого нет или значение не внесли.
    sugars_g: Mapped[Decimal | None] = mapped_column(MACRO)
    saturated_fat_g: Mapped[Decimal | None] = mapped_column(MACRO)
    fiber_g: Mapped[Decimal | None] = mapped_column(MACRO)
    salt_g: Mapped[Decimal | None] = mapped_column(MACRO)
    # Штрихкод с упаковки; пусто — продукт находится только по названию.
    barcode: Mapped[str | None] = mapped_column(BARCODE)
    # Откуда продукт: от этого зависит, что приложение показывает о его происхождении.
    source: Mapped[ProductSource] = mapped_column(choice(ProductSource), default=ProductSource.USER)
    # Автор; пусто, если его учётной записи больше нет, — тогда продукт правит администратор.
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class BarcodeMiss(Base):
    """Штрихкод, которого не оказалось в Open Food Facts: пока запись свежа, повторное
    сканирование наружу не идёт (ADR 0009). Кто спрашивал, не записывается."""

    __tablename__ = "barcode_misses"

    barcode: Mapped[str] = mapped_column(BARCODE, primary_key=True)
    checked_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Meal(Base):
    """Приём пищи в списке пользователя: предустановленный или свой, со своим названием.

    Убранный из списка приём не удаляется: записи прошлых дней остаются в нём (ADR 0008).
    """

    __tablename__ = "meals"
    __table_args__ = (
        one_of("preset", MealPreset),
        # У приёма есть имя: код предустановленного или название, которое дал пользователь.
        CheckConstraint("preset IS NOT NULL OR name IS NOT NULL", name="named"),
        # Предустановленный приём у пользователя один: повторный посев ничего не дублирует.
        Index(
            "uq_meals_user_preset",
            "user_id",
            "preset",
            unique=True,
            postgresql_where=text("preset IS NOT NULL"),
        ),
    )

    # Ключ своего приёма приходит от клиента (UUIDv7), предустановленного — выдаёт сервер.
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Код предустановленного приёма: его название подбирает интерфейс на языке пользователя.
    preset: Mapped[MealPreset | None] = mapped_column(choice(MealPreset))
    name: Mapped[str | None] = mapped_column(MEAL_NAME)
    # Место в дне: меньше — раньше.
    position: Mapped[int]
    # Когда приём убрали из списка; пусто — он в списке.
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


def preset_meals(user_id: UUID) -> list[Meal]:
    """Приёмы пищи, с которыми начинает каждый пользователь, в порядке дня."""
    return [
        Meal(id=uuid7(), user_id=user_id, preset=preset, position=position)
        for position, preset in enumerate(MealPreset)
    ]


class FoodEntry(Base):
    """Запись дневника питания: сколько продукта съедено в приёме пищи."""

    __tablename__ = "food_entries"
    __table_args__ = (
        one_of("unit", ProductUnit),
        # День дневника одного пользователя.
        Index("ix_food_entries_user_date", "user_id", "local_date"),
    )

    # Ключ приходит от клиента (UUIDv7), поэтому значения по умолчанию нет (ADR 0002).
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Календарный день пользователя, к которому относится запись (ADR 0003).
    local_date: Mapped[date]
    meal_id: Mapped[UUID] = mapped_column(ForeignKey("meals.id", ondelete="CASCADE"), index=True)
    # Сколько съедено — в единицах снимка: граммах или миллилитрах.
    amount: Mapped[Decimal] = mapped_column(Numeric(6, 1))
    # Из какого продукта каталога запись; пусто, если продукт с тех пор удалили.
    product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    # Снимок продукта на момент внесения — название, единица и состав на 100 единиц. Итоги
    # считаются по нему, а не по каталогу: правка продукта не меняет прошлые дни
    # (инвариант I10).
    product_name: Mapped[str] = mapped_column(PRODUCT_NAME)
    unit: Mapped[ProductUnit] = mapped_column(choice(ProductUnit))
    kcal: Mapped[Decimal] = mapped_column(KCAL)
    protein_g: Mapped[Decimal] = mapped_column(MACRO)
    fat_g: Mapped[Decimal] = mapped_column(MACRO)
    carbs_g: Mapped[Decimal] = mapped_column(MACRO)
    sugars_g: Mapped[Decimal | None] = mapped_column(MACRO)
    saturated_fat_g: Mapped[Decimal | None] = mapped_column(MACRO)
    fiber_g: Mapped[Decimal | None] = mapped_column(MACRO)
    salt_g: Mapped[Decimal | None] = mapped_column(MACRO)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    @property
    def eaten(self) -> Nutrients:
        """Нутриенты съеденной порции — по снимку."""
        per_100 = Nutrients(self.kcal, self.protein_g, self.fat_g, self.carbs_g)
        return per_100.portion(self.amount)


class NutritionGoal(Base):
    """Цель на день. Действует с `effective_from` до следующей цели: прошлые дни сверяются
    с той целью, что была у них. Пустой показатель — цели по нему нет; пустые все четыре —
    цель с этого дня снята."""

    __tablename__ = "nutrition_goals"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Календарный день пользователя, с которого цель действует (ADR 0003).
    effective_from: Mapped[date] = mapped_column(primary_key=True)
    kcal: Mapped[int | None]
    protein_g: Mapped[int | None]
    fat_g: Mapped[int | None]
    carbs_g: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
