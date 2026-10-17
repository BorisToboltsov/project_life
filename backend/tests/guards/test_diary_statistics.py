"""I19: средние не превращают пропуски в нули и сравниваются с теми же днями."""

from datetime import date
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import NutritionGoal
from tests.conftest import MakeUser
from tests.nutrition import add_entry, add_product, put_product, read_day

pytestmark = pytest.mark.anyio


async def test_statistics_contract(
    client: AsyncClient, make_user: MakeUser, db: AsyncSession
) -> None:
    owner, stranger = await make_user(), await make_user()
    product = await add_product(client, owner)
    for amount in [0.1, 0.1, 0.1]:
        await add_entry(client, owner, product, amount, day="2024-02-05")
    await add_entry(client, owner, product, 100, day="2024-02-07")
    await add_entry(client, stranger, product, 500, day="2024-02-07")
    db.add_all(
        [
            NutritionGoal(
                user_id=UUID(owner.id),
                effective_from=date(2024, 1, 1),
                kcal=2000,
                protein_g=None,
                fat_g=60,
                carbs_g=200,
                water_ml=2000,
            ),
            NutritionGoal(
                user_id=UUID(owner.id),
                effective_from=date(2024, 2, 7),
                kcal=2200,
                protein_g=120,
                fat_g=None,
                carbs_g=0,
                water_ml=None,
            ),
        ]
    )
    await db.commit()
    expected = [await read_day(client, owner, d) for d in ["2024-02-05", "2024-02-07"]]
    path = "/api/diary/stats?period=week&date=2024-02-06"
    before = (await client.get(path, headers=owner.headers)).json()
    assert before["kcal"] == {"value": 60.68, "goal": 2100, "days": 2, "goal_days": 2}
    assert before["protein_g"]["goal"] is None
    assert before["protein_g"]["goal_days"] == 1
    assert before["fat_g"]["goal"] is None
    assert before["carbs_g"]["goal"] == 100
    assert before["days"][1]["totals"] is None
    for index, day in zip([0, 2], expected, strict=True):
        assert before["days"][index]["totals"] == day["totals"]
        assert before["days"][index]["goal"] == day["goal"]
    # Ни правка/удаление продукта, ни архивирование приёма не меняют статистику.
    await put_product(
        client,
        owner,
        {"name": "Другой", "unit": "g", "kcal": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0},
        product,
    )
    await client.delete(f"/api/products/{product}", headers=owner.headers)
    meal = expected[0]["meals"][0]["id"]
    await client.delete(f"/api/diary/meals/{meal}", headers=owner.headers)
    assert (await client.get(path, headers=owner.headers)).json() == before
    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers=stranger.headers)).json()["kcal"]["value"] == 605
