from datetime import UTC, date, datetime
from uuid import UUID, uuid7

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.metrics import MetricPreset
from app.models import Measurement, Metric, NutritionGoal, WaterIntake
from app.services.diary_statistics import period_bounds, statistics
from tests.conftest import MakeUser
from tests.nutrition import add_entry, add_product

pytestmark = pytest.mark.anyio


async def test_empty_and_calendar(client: AsyncClient, make_user: MakeUser) -> None:
    owner = await make_user()
    response = await client.get(
        "/api/diary/stats", headers=owner.headers, params={"period": "month", "date": "2024-02-15"}
    )
    assert response.status_code == 200
    data = response.json()
    assert (data["start"], data["end"], len(data["days"])) == ("2024-02-01", "2024-02-29", 29)
    assert data["kcal"] == {"value": None, "goal": None, "days": 0, "goal_days": 0}
    assert data["first_weight"] is data["last_weight"] is None
    assert period_bounds(date(2025, 1, 1), "week") == (date(2024, 12, 30), date(2025, 1, 5))
    for params in [
        {"period": "year", "date": "2024-01-01"},
        {"date": "bad"},
        {"date": "9999-12-31"},
        {"date": "1899-12-31"},
    ]:
        assert (
            await client.get("/api/diary/stats", headers=owner.headers, params=params)
        ).status_code == 422


async def test_zero_future_water_and_removed_goal(
    client: AsyncClient, make_user: MakeUser, db: AsyncSession
) -> None:
    owner = await make_user()
    uid = UUID(owner.id)
    product = await add_product(client, owner, kcal=0, protein_g=0, fat_g=0, carbs_g=0)
    await add_entry(client, owner, product, day="2024-02-05")
    await add_entry(client, owner, product, day="2024-02-09")
    db.add_all(
        [
            WaterIntake(id=uuid7(), user_id=uid, local_date=date(2024, 2, 6), amount_ml=500),
            WaterIntake(id=uuid7(), user_id=uid, local_date=date(2024, 2, 7), amount_ml=1000),
            WaterIntake(id=uuid7(), user_id=uid, local_date=date(2024, 2, 9), amount_ml=2000),
            NutritionGoal(user_id=uid, effective_from=date(2024, 2, 1), kcal=2000, water_ml=2000),
            NutritionGoal(user_id=uid, effective_from=date(2024, 2, 7)),
        ]
    )
    await db.commit()
    data = await statistics(db, uid, date(2024, 2, 5), "week", date(2024, 2, 7))
    assert data.kcal.value == 0
    assert data.kcal.days == 1
    assert data.kcal.goal == 2000
    assert data.water_ml.value == 750
    assert data.water_ml.days == 2
    assert data.water_ml.goal is None
    assert data.water_ml.goal_days == 1
    assert data.days[2].goal is None
    assert data.days[4].future
    assert data.days[4].totals is None
    assert data.days[4].water_ml is None
    future = await statistics(db, uid, date(2024, 3, 1), "month", date(2024, 2, 7))
    assert future.kcal.value is None
    assert all(d.future for d in future.days)


async def test_weight_order_scope_and_single(
    client: AsyncClient, make_user: MakeUser, db: AsyncSession
) -> None:
    owner, stranger = await make_user(), await make_user()
    uid = UUID(owner.id)
    metric = await db.scalar(
        select(Metric).where(Metric.user_id == uid, Metric.preset == MetricPreset.WEIGHT)
    )
    assert metric is not None
    metric.archived_at = datetime.now(UTC)
    custom = Metric(id=uuid7(), user_id=uid, name="Другая масса", quantity="mass", position=8)
    db.add(custom)
    await db.flush()
    other = await db.scalar(
        select(Metric).where(
            Metric.user_id == UUID(stranger.id), Metric.preset == MetricPreset.WEIGHT
        )
    )
    assert other is not None

    def measurement(day: int, hour: int, value: int, metric: Metric) -> Measurement:
        return Measurement(
            id=uuid7(),
            user_id=metric.user_id,
            metric_id=metric.id,
            value=value,
            original_value=value,
            original_unit="kg",
            local_date=date(2024, 2, day),
            measured_at=datetime(2024, 2, day, hour, tzinfo=UTC),
        )

    first, last = measurement(5, 8, 80, metric), measurement(5, 18, 79, metric)
    db.add_all(
        [
            first,
            last,
            measurement(1, 8, 90, metric),
            measurement(12, 8, 70, metric),
            measurement(6, 8, 40, custom),
            measurement(6, 8, 100, other),
        ]
    )
    await db.commit()
    data = await statistics(db, uid, date(2024, 2, 5), "week", date(2024, 2, 11))
    assert data.first_weight
    assert data.first_weight.id == first.id
    assert data.last_weight
    assert data.last_weight.id == last.id
    await db.delete(last)
    await db.commit()
    single = await statistics(db, uid, date(2024, 2, 5), "week", date(2024, 2, 11))
    assert single.first_weight
    assert single.last_weight is None
