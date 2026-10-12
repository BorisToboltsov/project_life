"""Гейт истории замеров (инвариант I13): перестройка списка видов не трогает внесённое.

Вид замера убирают из списка, а не удаляют: его замеры остаются и возвращаются вместе с
ним. Величина вида задаётся один раз — внесённые значения лежат в её единице, и смена
величины молча превратила бы сантиметры в килограммы.
"""

import uuid

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.measurements import (
    add_metric,
    add_preset,
    days_ago,
    history,
    list_metrics,
    metric_id,
    put_measurement,
    put_metric,
    reading,
    remove_metric,
)

pytestmark = pytest.mark.anyio


async def test_removing_a_preset_keeps_its_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    weight = await metric_id(client, user)
    await put_measurement(client, user, reading(weight, value=72.8, **days_ago(1)))
    await put_measurement(client, user, reading(weight))
    before = await history(client, user, weight)

    removed = await remove_metric(client, user, weight)

    assert removed.status_code == 204
    assert await history(client, user, weight) == before
    assert [item["value"] for item in before] == [72.4, 72.8]


async def test_returned_preset_comes_back_with_its_history(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    weight = await metric_id(client, user)
    await put_measurement(client, user, reading(weight))
    before = await history(client, user, weight)
    await remove_metric(client, user, weight)

    returned = await add_preset(client, user, "weight")

    assert returned.json()["id"] == weight
    assert await history(client, user, weight) == before


async def test_removing_and_returning_an_own_metric_keeps_its_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    wrist = await add_metric(client, user, "Запястье")
    await put_measurement(client, user, reading(wrist, value=16.5, unit="cm"))
    before = await history(client, user, wrist)

    await remove_metric(client, user, wrist)
    kept = await history(client, user, wrist)
    await put_metric(client, user, "Запястье", record_id=wrist)

    assert kept == before
    assert await history(client, user, wrist) == before
    assert [item["value"] for item in before] == [16.5]


async def test_renaming_an_own_metric_keeps_its_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    wrist = await add_metric(client, user, "Запястье")
    await put_measurement(client, user, reading(wrist, value=16.5, unit="cm"))
    before = await history(client, user, wrist)

    renamed = await put_metric(client, user, "Запястье правое", record_id=wrist)

    assert renamed.status_code == 200
    assert await history(client, user, wrist) == before


@pytest.mark.parametrize("quantity", ["mass", "percent"])
async def test_quantity_of_a_metric_cannot_be_changed(
    client: AsyncClient, make_user: MakeUser, quantity: str
) -> None:
    user = await make_user()
    wrist = await add_metric(client, user, "Запястье", "length")
    await put_measurement(client, user, reading(wrist, value=16.5, unit="cm"))

    response = await put_metric(client, user, "Запястье", quantity, record_id=wrist)

    assert response.status_code == 422
    own = [metric for metric in (await list_metrics(client, user))["metrics"] if metric["name"]]
    assert [(metric["quantity"], metric["unit"]) for metric in own] == [("length", "cm")]
    assert [item["unit"] for item in await history(client, user, wrist)] == ["cm"]


async def test_no_route_deletes_a_metric_with_its_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Сколько бы раз вид ни убирали, строка замера остаётся в базе."""
    from sqlalchemy import func, select

    from app.db import session_factory
    from app.models import Measurement, Metric

    user = await make_user()
    wrist = await add_metric(client, user, "Запястье")
    record_id = str(uuid.uuid7())
    await put_measurement(client, user, reading(wrist, value=16.5, unit="cm"), record_id)

    for _ in range(2):
        await remove_metric(client, user, wrist)

    async with session_factory() as db:
        assert await db.get(Metric, uuid.UUID(wrist)) is not None
        assert await db.scalar(select(func.count()).select_from(Measurement)) == 1
