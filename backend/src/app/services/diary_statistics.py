"""Статистика дневника: календарные периоды, снимки состава и исторические цели."""

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.metrics import MetricPreset
from app.models import FoodEntry, Measurement, Metric, NutritionGoal, WaterIntake
from app.schemas import (
    DiaryStatisticsOut,
    MeasurementOut,
    NutrientsOut,
    NutritionGoalOut,
    StatisticsAverage,
    StatisticsDay,
    StatisticsPeriod,
)

NUTRIENTS = ("kcal", "protein_g", "fat_g", "carbs_g")


def period_bounds(anchor: date, period: StatisticsPeriod) -> tuple[date, date]:
    if period == "week":
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    return anchor.replace(day=1), anchor.replace(day=monthrange(anchor.year, anchor.month)[1])


def average(days: list[StatisticsDay], name: str) -> StatisticsAverage:
    samples: list[Decimal] = []
    targets: list[int] = []
    for day in days:
        value = (
            day.water_ml
            if name == "water_ml"
            else (getattr(day.totals, name) if day.totals else None)
        )
        if day.future or value is None:
            continue
        samples.append(Decimal(str(value)))
        target = getattr(day.goal, name) if day.goal else None
        if target is not None:
            targets.append(target)
    count = len(samples)
    return StatisticsAverage(
        value=float(sum(samples) / count) if count else None,
        goal=sum(targets) / count if count and len(targets) == count else None,
        days=count,
        goal_days=len(targets),
    )


async def statistics(
    db: AsyncSession, user_id: UUID, anchor: date, period: StatisticsPeriod, today: date
) -> DiaryStatisticsOut:
    start, end = period_bounds(anchor, period)
    through = min(end, today)
    # Округляем каждую порцию до сотой, как Nutrients.portion, затем складываем.
    food_rows = await db.execute(
        select(
            FoodEntry.local_date,
            *[
                func.sum(func.round(getattr(FoodEntry, name) * FoodEntry.amount / 100, 2))
                for name in NUTRIENTS
            ],
        )
        .where(FoodEntry.user_id == user_id, FoodEntry.local_date.between(start, through))
        .group_by(FoodEntry.local_date)
    )
    food = {row[0]: NutrientsOut(**dict(zip(NUTRIENTS, row[1:], strict=True))) for row in food_rows}
    water = dict(
        (
            await db.execute(
                select(WaterIntake.local_date, func.sum(WaterIntake.amount_ml))
                .where(
                    WaterIntake.user_id == user_id, WaterIntake.local_date.between(start, through)
                )
                .group_by(WaterIntake.local_date)
            )
        ).all()
    )
    # Только последняя цель до периода и изменения внутри; снятие цели тоже изменение.
    previous = (
        select(func.max(NutritionGoal.effective_from))
        .where(NutritionGoal.user_id == user_id, NutritionGoal.effective_from <= start)
        .scalar_subquery()
    )
    goals = list(
        await db.scalars(
            select(NutritionGoal)
            .where(
                NutritionGoal.user_id == user_id,
                NutritionGoal.effective_from <= end,
                (NutritionGoal.effective_from >= start)
                | (NutritionGoal.effective_from == previous),
            )
            .order_by(NutritionGoal.effective_from)
        )
    )
    days: list[StatisticsDay] = []
    goal: NutritionGoalOut | None = None
    index = 0
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        while index < len(goals) and goals[index].effective_from <= day:
            goal = NutritionGoalOut.model_validate(goals[index]).if_set()
            index += 1
        days.append(
            StatisticsDay(
                local_date=day,
                future=day > today,
                totals=food.get(day),
                water_ml=water.get(day),
                goal=goal,
            )
        )
    weights = list(
        await db.scalars(
            select(Measurement)
            .join(Metric, Measurement.metric_id == Metric.id)
            .where(
                Measurement.user_id == user_id,
                Metric.user_id == user_id,
                Metric.preset == MetricPreset.WEIGHT,
                Measurement.local_date.between(start, through),
            )
            .order_by(Measurement.local_date, Measurement.measured_at, Measurement.id)
        )
    )
    return DiaryStatisticsOut(
        period=period,
        start=start,
        end=end,
        today=today,
        days=days,
        kcal=average(days, "kcal"),
        protein_g=average(days, "protein_g"),
        fat_g=average(days, "fat_g"),
        carbs_g=average(days, "carbs_g"),
        water_ml=average(days, "water_ml"),
        first_weight=MeasurementOut.model_validate(weights[0]) if weights else None,
        last_weight=MeasurementOut.model_validate(weights[-1]) if len(weights) > 1 else None,
    )
