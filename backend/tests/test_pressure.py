import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.measurements import add_preset, metric_id, put_measurement, put_metric, reading
from tests.pressure import bp, put_bp, readings

pytestmark = pytest.mark.anyio


async def test_reading_is_saved_once_and_replaced(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    key = str(uuid.uuid7())

    created = await put_bp(client, user, bp(), key)
    replaced = await put_bp(client, user, bp(142, 91, None), key)

    assert created.status_code == 201
    assert replaced.status_code == 200
    assert [
        (item["systolic"], item["diastolic"], item["pulse"])
        for item in await readings(client, user)
    ] == [(142, 91, None)]


async def test_readings_come_newest_first(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    await put_bp(client, user, bp(120, 80, days_ago=2))
    await put_bp(client, user, bp(130, 85))

    assert [item["systolic"] for item in await readings(client, user)] == [130, 120]


async def test_delete_removes_the_reading(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    key = (await put_bp(client, user, bp())).json()["id"]

    deleted = await client.delete(f"/api/blood-pressure/{key}", headers=user.headers)
    again = await client.delete(f"/api/blood-pressure/{key}", headers=user.headers)

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert await readings(client, user) == []


async def test_list_answers_not_modified_until_something_changes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    await put_bp(client, user, bp())
    etag = (await client.get("/api/blood-pressure", headers=user.headers)).headers["etag"]

    same = await client.get("/api/blood-pressure", headers={**user.headers, "If-None-Match": etag})
    await put_bp(client, user, bp(135, 85))
    changed = await client.get(
        "/api/blood-pressure", headers={**user.headers, "If-None-Match": etag}
    )

    assert same.status_code == 304
    assert changed.status_code == 200


async def test_readings_of_another_user_are_not_listed(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    await put_bp(client, owner, bp())

    assert await readings(client, stranger) == []


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(bp(80, 80), id="systolic not above diastolic"),
        pytest.param(bp(40, 20), id="too low"),
        pytest.param(bp(320, 120), id="too high"),
        pytest.param(bp(pulse=300), id="pulse too high"),
        pytest.param(bp(days_ago=-3), id="future"),
        pytest.param({**bp(), "systolic": 128.5}, id="fraction"),
    ],
)
async def test_implausible_reading_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()

    response = await put_bp(client, user, body)

    assert response.status_code == 422
    assert await readings(client, user) == []


async def test_blood_pressure_is_a_recommended_preset(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    added = await add_preset(client, user, "blood_pressure")

    assert added.status_code == 200
    assert added.json()["quantity"] == "pressure"
    assert added.json()["unit"] == "mmhg"


async def test_pressure_is_not_entered_as_a_measurement(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    pressure = await metric_id(client, user, "blood_pressure")

    response = await put_measurement(client, user, reading(pressure, value=128, unit="mmhg"))

    assert response.status_code == 422


async def test_own_metric_cannot_measure_pressure(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    response = await put_metric(client, user, "Давление на ноге", "pressure")

    assert response.status_code == 422
