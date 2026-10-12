import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.measurements import (
    NOW,
    add_metric,
    days_ago,
    history,
    list_metrics,
    metric_id,
    put_measurement,
    reading,
    remove_metric,
)

pytestmark = pytest.mark.anyio


# --- Сохранение -------------------------------------------------------------------------


async def test_measurement_is_created_with_the_client_id(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    record_id = str(uuid.uuid7())

    response = await put_measurement(client, account, reading(weight), record_id)

    assert response.status_code == 201
    assert response.json() == {
        "id": record_id,
        "metric_id": weight,
        "value": 72.4,
        "unit": "kg",
        "original_value": 72.4,
        "original_unit": "kg",
        "measured_at": response.json()["measured_at"],
        "local_date": NOW.date().isoformat(),
    }
    assert datetime.fromisoformat(response.json()["measured_at"]) == NOW


async def test_repeated_request_does_not_duplicate(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    record_id = str(uuid.uuid7())

    first = await put_measurement(client, account, reading(weight), record_id)
    again = await put_measurement(client, account, reading(weight), record_id)

    assert (first.status_code, again.status_code) == (201, 200)
    assert [item["id"] for item in await history(client, account, weight)] == [record_id]


async def test_saving_under_the_same_id_replaces_the_record(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    record_id = str(uuid.uuid7())
    await put_measurement(client, account, reading(weight), record_id)

    response = await put_measurement(
        client, account, reading(weight, value=71.9, **days_ago(2)), record_id
    )

    assert response.status_code == 200
    assert response.json()["value"] == 71.9
    assert response.json()["local_date"] == (NOW - timedelta(days=2)).date().isoformat()


@pytest.mark.parametrize(
    ("preset", "value", "unit", "canonical", "canonical_unit"),
    [
        ("weight", 165.4, "lb", 75.024, "kg"),
        ("neck", 15.5, "in", 39.37, "cm"),
        ("waist", 86, "cm", 86, "cm"),
        ("hips", 38.25, "in", 97.155, "cm"),
        ("biceps", 36.5, "cm", 36.5, "cm"),
        ("body_fat", 18.5, "percent", 18.5, "percent"),
    ],
)
async def test_value_is_stored_canonically_and_as_entered(
    client: AsyncClient,
    make_user: MakeUser,
    preset: str,
    value: float,
    unit: str,
    canonical: float,
    canonical_unit: str,
) -> None:
    account = await make_user()
    metric = await metric_id(client, account, preset)

    response = await put_measurement(client, account, reading(metric, value=value, unit=unit))

    saved = response.json()
    assert (saved["value"], saved["unit"]) == (canonical, canonical_unit)
    assert (saved["original_value"], saved["original_unit"]) == (value, unit)


@pytest.mark.parametrize(
    ("quantity", "value", "unit", "canonical_unit"),
    [
        ("length", 6.5, "in", "cm"),
        ("mass", 31.2, "kg", "kg"),
        ("percent", 54.5, "percent", "percent"),
    ],
)
async def test_own_metric_takes_values_of_its_quantity(
    client: AsyncClient,
    make_user: MakeUser,
    quantity: str,
    value: float,
    unit: str,
    canonical_unit: str,
) -> None:
    account = await make_user()
    metric = await add_metric(client, account, "Свой показатель", quantity)

    response = await put_measurement(client, account, reading(metric, value=value, unit=unit))

    assert response.status_code == 201
    assert response.json()["unit"] == canonical_unit
    assert (response.json()["original_value"], response.json()["original_unit"]) == (value, unit)


@pytest.mark.parametrize(
    "overrides",
    [
        {"value": 0},
        {"value": -5},
        {"value": 1.5},
        {"value": 700},
        {"value": 1200, "unit": "lb"},
        {"value": 72.4567},
        {"unit": "cm"},
        {"unit": "percent"},
        {"unit": "stone"},
        {"measured_at": (NOW + timedelta(days=3)).isoformat()},
        {"measured_at": NOW.replace(tzinfo=None).isoformat()},
        {"local_date": (NOW - timedelta(days=5)).date().isoformat()},
        {"local_date": "1850-01-01", "measured_at": "1850-01-01T12:00:00+00:00"},
        {"user_id": str(uuid.uuid7())},
        {"metric": "weight"},
    ],
)
async def test_invalid_measurement_is_rejected(
    client: AsyncClient, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)

    response = await put_measurement(client, account, reading(weight, **overrides))

    assert response.status_code == 422
    assert await history(client, account, weight) == []


@pytest.mark.parametrize(
    ("preset", "value", "unit"),
    [
        ("waist", 86, "kg"),
        ("neck", 5, "cm"),
        ("biceps", 150, "cm"),
        ("body_fat", 18.5, "cm"),
        ("body_fat", 90, "percent"),
    ],
)
async def test_value_must_fit_the_metric(
    client: AsyncClient, make_user: MakeUser, preset: str, value: float, unit: str
) -> None:
    account = await make_user()
    metric = await metric_id(client, account, preset)

    response = await put_measurement(client, account, reading(metric, value=value, unit=unit))

    assert response.status_code == 422
    assert await history(client, account, metric) == []


@pytest.mark.parametrize(
    ("quantity", "value", "unit"),
    [("length", 350, "cm"), ("length", 20, "kg"), ("mass", 600, "kg"), ("percent", 101, "percent")],
)
async def test_own_metric_rejects_values_outside_its_quantity(
    client: AsyncClient, make_user: MakeUser, quantity: str, value: float, unit: str
) -> None:
    account = await make_user()
    metric = await add_metric(client, account, "Свой показатель", quantity)

    response = await put_measurement(client, account, reading(metric, value=value, unit=unit))

    assert response.status_code == 422


async def test_measurement_needs_a_metric_from_the_own_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account, stranger = await make_user(), await make_user()
    foreign = await metric_id(client, stranger)

    unknown = await put_measurement(client, account, reading(str(uuid.uuid7())))
    not_mine = await put_measurement(client, account, reading(foreign))

    assert (unknown.status_code, not_mine.status_code) == (404, 404)
    assert unknown.json() == not_mine.json() == {"detail": "metric_not_found"}
    assert await history(client, stranger, foreign) == []


async def test_removed_metric_still_takes_corrections(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    record_id = str(uuid.uuid7())
    await put_measurement(client, account, reading(weight), record_id)
    await remove_metric(client, account, weight)

    response = await put_measurement(client, account, reading(weight, value=72.1), record_id)

    assert response.status_code == 200
    assert [item["value"] for item in await history(client, account, weight)] == [72.1]


async def test_record_id_must_be_a_version_7_uuid(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    weight = await metric_id(client, account)

    response = await put_measurement(client, account, reading(weight), str(uuid.uuid4()))

    assert response.status_code == 422


def lose_the_first_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Имитирует гонку: первая проверка «есть ли запись» отвечает «нет», хотя она уже создана."""
    from app.api import measurements

    real = measurements._own_measurement  # pyright: ignore[reportPrivateUsage]
    calls = 0

    async def racing(*args: Any) -> Any:
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real(*args)

    monkeypatch.setattr(measurements, "_own_measurement", racing)


async def test_parallel_creation_with_one_id_ends_as_a_replace(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    record_id = str(uuid.uuid7())
    await put_measurement(client, account, reading(weight), record_id)
    lose_the_first_lookup(monkeypatch)

    response = await put_measurement(client, account, reading(weight, value=71.5), record_id)

    assert response.status_code == 200
    assert [item["value"] for item in await history(client, account, weight)] == [71.5]


async def test_parallel_creation_cannot_take_over_a_foreign_id(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, stranger = await make_user(), await make_user()
    weight = await metric_id(client, owner)
    record_id = str(uuid.uuid7())
    await put_measurement(client, owner, reading(weight), record_id)
    lose_the_first_lookup(monkeypatch)

    response = await put_measurement(
        client, stranger, reading(await metric_id(client, stranger), value=99), record_id
    )

    assert response.status_code == 404
    assert [item["value"] for item in await history(client, owner, weight)] == [72.4]


# --- История ----------------------------------------------------------------------------


async def test_history_is_per_metric_newest_first(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    weight, waist = await metric_id(client, account), await metric_id(client, account, "waist")
    await put_measurement(client, account, reading(weight, value=73.0, **days_ago(3)))
    await put_measurement(client, account, reading(weight, value=72.4))
    await put_measurement(client, account, reading(weight, value=72.8, **days_ago(1)))
    await put_measurement(client, account, reading(waist, value=86, unit="cm"))

    weights = await history(client, account, weight)
    waists = await history(client, account, waist)

    assert [item["value"] for item in weights] == [72.4, 72.8, 73.0]
    assert [item["value"] for item in waists] == [86.0]


async def test_same_day_measurements_are_ordered_by_time(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    morning = NOW - timedelta(hours=3)
    day = morning.date().isoformat()
    await put_measurement(client, account, reading(weight, value=72.9, local_date=day))
    await put_measurement(
        client,
        account,
        reading(weight, value=72.1, measured_at=morning.isoformat(), local_date=day),
    )

    listed = await history(client, account, weight)

    assert [item["value"] for item in listed] == [72.9, 72.1]


async def test_history_can_be_limited_to_a_period(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    for days in (0, 5, 10, 40):
        await put_measurement(
            client, account, reading(weight, value=70 + days / 10, **days_ago(days))
        )
    start = (NOW - timedelta(days=10)).date().isoformat()
    end = (NOW - timedelta(days=5)).date().isoformat()

    listed = await history(client, account, weight, **{"from": start, "to": end})

    assert [item["value"] for item in listed] == [70.5, 71.0]


async def test_history_requires_a_metric(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    missing = await client.get("/api/measurements", headers=account.headers)
    by_code = await client.get("/api/measurements?metric_id=weight", headers=account.headers)

    assert missing.status_code == by_code.status_code == 422


# --- Сводка -----------------------------------------------------------------------------


async def test_summary_gives_latest_and_previous_for_every_metric(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    listed = [metric["id"] for metric in (await list_metrics(client, account))["metrics"]]
    weight, neck, waist, _ = listed
    await put_measurement(client, account, reading(weight, value=73.5, **days_ago(9)))
    await put_measurement(client, account, reading(weight, value=72.8, **days_ago(2)))
    await put_measurement(client, account, reading(weight, value=72.4))
    await put_measurement(client, account, reading(neck, value=38, unit="cm", **days_ago(1)))

    response = await client.get("/api/measurements/summary", headers=account.headers)

    summary = {item["metric_id"]: item for item in response.json()}
    assert list(summary) == listed
    assert summary[weight]["latest"]["value"] == 72.4
    assert summary[weight]["previous"]["value"] == 72.8
    assert summary[neck]["latest"]["value"] == 38.0
    assert summary[neck]["previous"] is None
    assert summary[waist] == {"metric_id": waist, "latest": None, "previous": None}


async def test_summary_covers_own_and_removed_metrics(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    wrist = await add_metric(client, account)
    await put_measurement(client, account, reading(weight))
    await put_measurement(client, account, reading(wrist, value=16.5, unit="cm"))
    await remove_metric(client, account, weight)

    response = await client.get("/api/measurements/summary", headers=account.headers)

    summary = {item["metric_id"]: item for item in response.json()}
    assert summary[weight]["latest"]["value"] == 72.4
    assert summary[wrist]["latest"]["value"] == 16.5


# --- Удаление ---------------------------------------------------------------------------


async def test_measurement_can_be_deleted(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    weight = await metric_id(client, account)
    record_id = str(uuid.uuid7())
    await put_measurement(client, account, reading(weight), record_id)

    deleted = await client.delete(f"/api/measurements/{record_id}", headers=account.headers)
    again = await client.delete(f"/api/measurements/{record_id}", headers=account.headers)

    assert (deleted.status_code, again.status_code) == (204, 404)
    assert await history(client, account, weight) == []


# --- Изоляция ---------------------------------------------------------------------------


async def test_users_do_not_see_or_touch_each_others_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    weight = await metric_id(client, owner)
    record_id = str(uuid.uuid7())
    await put_measurement(client, owner, reading(weight), record_id)

    listed = await history(client, stranger, weight)
    summary = await client.get("/api/measurements/summary", headers=stranger.headers)
    overwrite = await put_measurement(
        client, stranger, reading(await metric_id(client, stranger), value=99), record_id
    )
    delete = await client.delete(f"/api/measurements/{record_id}", headers=stranger.headers)

    assert listed == []
    assert all(item["latest"] is None for item in summary.json())
    assert (overwrite.status_code, delete.status_code) == (404, 404)
    assert [item["value"] for item in await history(client, owner, weight)] == [72.4]


async def test_deleting_the_user_deletes_their_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    from sqlalchemy import func, select

    from app.db import session_factory
    from app.models import Measurement, Metric, User

    account = await make_user()
    await put_measurement(client, account, reading(await metric_id(client, account)))

    async with session_factory() as db:
        await db.delete(await db.get_one(User, account.id))
        await db.commit()
        measurements = await db.scalar(select(func.count()).select_from(Measurement))
        metrics = await db.scalar(select(func.count()).select_from(Metric))

    assert (measurements, metrics) == (0, 0)
