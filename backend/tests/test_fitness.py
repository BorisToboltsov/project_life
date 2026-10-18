"""Результаты физических тестов: запись, замена, удаление и копия (ADR 0021)."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.fitness import cooper, moment, pull_ups, push_ups, put_result, results

pytestmark = pytest.mark.anyio


async def test_cooper_distance_is_kept_in_meters_and_as_entered(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    created = await put_result(client, user, cooper(1.65, "mi"))

    assert created.status_code == 201
    body = created.json()
    assert body["test"] == "cooper"
    assert body["distance_m"] == pytest.approx(2655.418, abs=0.001)
    assert (body["distance_value"], body["distance_unit"]) == (1.65, "mi")
    assert body["reps"] is None
    assert body["variant"] is None


async def test_push_ups_keep_their_variant(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    created = await put_result(client, user, push_ups(24, "knee"))

    assert created.status_code == 201
    assert (created.json()["reps"], created.json()["variant"]) == (24, "knee")


async def test_repeating_a_request_replaces_the_same_result(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    key = str(uuid.uuid7())
    await put_result(client, user, pull_ups(10), key)

    replaced = await put_result(client, user, pull_ups(12), key)

    assert replaced.status_code == 200
    assert [(item["id"], item["reps"]) for item in await results(client, user)] == [(key, 12)]


async def test_results_come_newest_first(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    await put_result(client, user, cooper(2400, days_ago=30))
    await put_result(client, user, push_ups(days_ago=2))
    await put_result(client, user, cooper(2650, days_ago=1))

    listed = await results(client, user)

    assert [item["local_date"] for item in listed] == sorted(
        (item["local_date"] for item in listed), reverse=True
    )
    assert len(listed) == 3


async def test_delete_removes_the_result(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    key = str(uuid.uuid7())
    await put_result(client, user, pull_ups(), key)

    deleted = await client.delete(f"/api/fitness-results/{key}", headers=user.headers)
    again = await client.delete(f"/api/fitness-results/{key}", headers=user.headers)

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert await results(client, user) == []


async def test_list_answers_not_modified_until_something_changes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    await put_result(client, user, pull_ups())
    first = await client.get("/api/fitness-results", headers=user.headers)
    etag = first.headers["ETag"]

    same = await client.get("/api/fitness-results", headers={**user.headers, "If-None-Match": etag})
    await put_result(client, user, push_ups())
    changed = await client.get(
        "/api/fitness-results", headers={**user.headers, "If-None-Match": etag}
    )

    assert same.status_code == 304
    assert changed.status_code == 200
    assert len(changed.json()) == 2


async def test_results_of_another_user_are_not_listed(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    await put_result(client, owner, cooper())

    assert await results(client, stranger) == []


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({**cooper(), "distance_value": 300}, id="cooper too short"),
        pytest.param({**cooper(), "distance_value": 7000}, id="cooper too long"),
        pytest.param({**cooper(4, "mi")}, id="cooper too long in miles"),
        pytest.param({**pull_ups(), "reps": 0}, id="no reps"),
        pytest.param({**pull_ups(), "reps": 1001}, id="too many reps"),
        pytest.param({**push_ups(), "variant": "diamond"}, id="unknown variant"),
        pytest.param({**cooper(), "distance_unit": "km"}, id="unknown unit"),
        pytest.param({**cooper(), "tested_at": "2999-01-01T12:00:00+00:00"}, id="future"),
        pytest.param({**pull_ups(), **moment(), "local_date": "2020-01-01"}, id="date mismatch"),
    ],
)
async def test_implausible_result_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()

    response = await put_result(client, user, body)

    assert response.status_code == 422
    assert await results(client, user) == []
