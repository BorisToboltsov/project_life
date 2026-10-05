import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response

from tests.conftest import Account, MakeUser

pytestmark = pytest.mark.anyio

NOW = datetime.now(UTC)


def body(**overrides: Any) -> dict[str, Any]:
    return {
        "metric": "weight",
        "value": 72.4,
        "unit": "kg",
        "measured_at": NOW.isoformat(),
        "local_date": NOW.date().isoformat(),
        **overrides,
    }


def on(days_ago: int, **overrides: Any) -> dict[str, Any]:
    moment = NOW - timedelta(days=days_ago)
    return body(measured_at=moment.isoformat(), local_date=moment.date().isoformat(), **overrides)


async def save(
    client: AsyncClient, account: Account, payload: dict[str, Any], record_id: str | None = None
) -> Response:
    return await client.put(
        f"/api/measurements/{record_id or uuid.uuid7()}", headers=account.headers, json=payload
    )


# --- Сохранение -------------------------------------------------------------------------


async def test_measurement_is_created_with_the_client_id(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())

    response = await save(client, account, body(), record_id)

    assert response.status_code == 201
    assert response.json() == {
        "id": record_id,
        "metric": "weight",
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
    record_id = str(uuid.uuid7())

    first = await save(client, account, body(), record_id)
    again = await save(client, account, body(), record_id)

    assert (first.status_code, again.status_code) == (201, 200)
    listed = await client.get("/api/measurements?metric=weight", headers=account.headers)
    assert [item["id"] for item in listed.json()] == [record_id]


async def test_saving_under_the_same_id_replaces_the_record(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())
    await save(client, account, body(), record_id)

    response = await save(client, account, on(2, value=71.9), record_id)

    assert response.status_code == 200
    assert response.json()["value"] == 71.9
    assert response.json()["local_date"] == (NOW - timedelta(days=2)).date().isoformat()


@pytest.mark.parametrize(
    ("metric", "value", "unit", "canonical", "canonical_unit"),
    [
        ("weight", 165.4, "lb", 75.024, "kg"),
        ("neck", 15.5, "in", 39.37, "cm"),
        ("waist", 86, "cm", 86, "cm"),
        ("hips", 38.25, "in", 97.155, "cm"),
    ],
)
async def test_value_is_stored_canonically_and_as_entered(
    client: AsyncClient,
    make_user: MakeUser,
    metric: str,
    value: float,
    unit: str,
    canonical: float,
    canonical_unit: str,
) -> None:
    account = await make_user()

    response = await save(client, account, body(metric=metric, value=value, unit=unit))

    saved = response.json()
    assert (saved["value"], saved["unit"]) == (canonical, canonical_unit)
    assert (saved["original_value"], saved["original_unit"]) == (value, unit)


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
        {"metric": "waist", "value": 86, "unit": "kg"},
        {"metric": "neck", "value": 5, "unit": "cm"},
        {"metric": "biceps", "value": 35, "unit": "cm"},
        {"unit": "stone"},
        {"measured_at": (NOW + timedelta(days=3)).isoformat()},
        {"measured_at": NOW.replace(tzinfo=None).isoformat()},
        {"local_date": (NOW - timedelta(days=5)).date().isoformat()},
        {"local_date": "1850-01-01", "measured_at": "1850-01-01T12:00:00+00:00"},
        {"user_id": str(uuid.uuid7())},
    ],
)
async def test_invalid_measurement_is_rejected(
    client: AsyncClient, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    account = await make_user()

    response = await save(client, account, body(**overrides))

    assert response.status_code == 422
    listed = await client.get("/api/measurements?metric=weight", headers=account.headers)
    assert listed.json() == []


async def test_record_id_must_be_a_version_7_uuid(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    response = await save(client, account, body(), str(uuid.uuid4()))

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
    record_id = str(uuid.uuid7())
    await save(client, account, body(), record_id)
    lose_the_first_lookup(monkeypatch)

    response = await save(client, account, body(value=71.5), record_id)

    assert response.status_code == 200
    listed = await client.get("/api/measurements?metric=weight", headers=account.headers)
    assert [item["value"] for item in listed.json()] == [71.5]


async def test_parallel_creation_cannot_take_over_a_foreign_id(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, stranger = await make_user(), await make_user()
    record_id = str(uuid.uuid7())
    await save(client, owner, body(), record_id)
    lose_the_first_lookup(monkeypatch)

    response = await save(client, stranger, body(value=99), record_id)

    assert response.status_code == 404
    mine = await client.get("/api/measurements?metric=weight", headers=owner.headers)
    assert [item["value"] for item in mine.json()] == [72.4]


# --- История ----------------------------------------------------------------------------


async def test_history_is_per_metric_newest_first(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    await save(client, account, on(3, value=73.0))
    await save(client, account, on(0, value=72.4))
    await save(client, account, on(1, value=72.8))
    await save(client, account, on(0, metric="waist", value=86, unit="cm"))

    weights = await client.get("/api/measurements?metric=weight", headers=account.headers)
    waists = await client.get("/api/measurements?metric=waist", headers=account.headers)

    assert [item["value"] for item in weights.json()] == [72.4, 72.8, 73.0]
    assert [item["value"] for item in waists.json()] == [86.0]


async def test_same_day_measurements_are_ordered_by_time(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    morning = NOW - timedelta(hours=3)
    day = morning.date().isoformat()
    await save(client, account, body(value=72.9, local_date=day))
    await save(client, account, body(value=72.1, measured_at=morning.isoformat(), local_date=day))

    listed = await client.get("/api/measurements?metric=weight", headers=account.headers)

    assert [item["value"] for item in listed.json()] == [72.9, 72.1]


async def test_history_can_be_limited_to_a_period(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    for days_ago in (0, 5, 10, 40):
        await save(client, account, on(days_ago, value=70 + days_ago / 10))
    start = (NOW - timedelta(days=10)).date().isoformat()
    end = (NOW - timedelta(days=5)).date().isoformat()

    response = await client.get(
        f"/api/measurements?metric=weight&from={start}&to={end}", headers=account.headers
    )

    assert [item["value"] for item in response.json()] == [70.5, 71.0]


async def test_history_requires_a_known_metric(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    missing = await client.get("/api/measurements", headers=account.headers)
    unknown = await client.get("/api/measurements?metric=biceps", headers=account.headers)

    assert missing.status_code == unknown.status_code == 422


# --- Сводка -----------------------------------------------------------------------------


async def test_summary_gives_latest_and_previous_for_every_metric(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    await save(client, account, on(9, value=73.5))
    await save(client, account, on(2, value=72.8))
    await save(client, account, on(0, value=72.4))
    await save(client, account, on(1, metric="neck", value=38, unit="cm"))

    response = await client.get("/api/measurements/summary", headers=account.headers)

    summary = {item["metric"]: item for item in response.json()}
    assert list(summary) == ["weight", "neck", "waist", "hips"]
    assert summary["weight"]["latest"]["value"] == 72.4
    assert summary["weight"]["previous"]["value"] == 72.8
    assert summary["neck"]["latest"]["value"] == 38.0
    assert summary["neck"]["previous"] is None
    assert summary["waist"] == {"metric": "waist", "latest": None, "previous": None}


# --- Удаление ---------------------------------------------------------------------------


async def test_measurement_can_be_deleted(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())
    await save(client, account, body(), record_id)

    deleted = await client.delete(f"/api/measurements/{record_id}", headers=account.headers)
    again = await client.delete(f"/api/measurements/{record_id}", headers=account.headers)

    assert (deleted.status_code, again.status_code) == (204, 404)
    listed = await client.get("/api/measurements?metric=weight", headers=account.headers)
    assert listed.json() == []


# --- Справочник -------------------------------------------------------------------------


async def test_metric_types_describe_units_and_ranges(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    response = await client.get("/api/metric-types", headers=account.headers)

    assert response.json() == [
        {"code": "weight", "quantity": "mass", "unit": "kg", "min_value": 2, "max_value": 500},
        {"code": "neck", "quantity": "length", "unit": "cm", "min_value": 15, "max_value": 80},
        {"code": "waist", "quantity": "length", "unit": "cm", "min_value": 30, "max_value": 250},
        {"code": "hips", "quantity": "length", "unit": "cm", "min_value": 30, "max_value": 250},
    ]


# --- Изоляция ---------------------------------------------------------------------------


async def test_users_do_not_see_or_touch_each_others_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    record_id = str(uuid.uuid7())
    await save(client, owner, body(), record_id)

    listed = await client.get("/api/measurements?metric=weight", headers=stranger.headers)
    summary = await client.get("/api/measurements/summary", headers=stranger.headers)
    overwrite = await save(client, stranger, body(value=99), record_id)
    delete = await client.delete(f"/api/measurements/{record_id}", headers=stranger.headers)

    assert listed.json() == []
    assert all(item["latest"] is None for item in summary.json())
    assert (overwrite.status_code, delete.status_code) == (404, 404)
    mine = await client.get("/api/measurements?metric=weight", headers=owner.headers)
    assert [item["value"] for item in mine.json()] == [72.4]


async def test_deleting_the_user_deletes_their_measurements(
    client: AsyncClient, make_user: MakeUser
) -> None:
    from sqlalchemy import func, select

    from app.db import session_factory
    from app.models import Measurement, User

    account = await make_user()
    await save(client, account, body())

    async with session_factory() as db:
        await db.delete(await db.get_one(User, account.id))
        await db.commit()
        remaining = await db.scalar(select(func.count()).select_from(Measurement))

    assert remaining == 0
