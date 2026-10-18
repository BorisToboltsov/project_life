"""Копия для работы без сети (ADR 0020): каталог целиком, последние дни дневника и все
замеры."""

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser
from tests.measurements import days_ago, history, metric_id, put_measurement, reading
from tests.nutrition import COTTAGE_CHEESE, OATMEAL, add_entry, add_product, put_product

pytestmark = pytest.mark.anyio

CATALOG = "/api/products/catalog"
MEASUREMENTS = "/api/measurements/all"


async def test_catalog_comes_whole_and_answers_304_until_it_changes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author, viewer = await make_user(), await make_user()
    cheese = await add_product(client, author)
    oats = await add_product(client, author, **OATMEAL)

    first = await client.get(CATALOG, headers=author.headers)
    etag = first.headers["etag"]
    same = await client.get(CATALOG, headers={**author.headers, "If-None-Match": etag})

    assert first.status_code == 200
    assert [row["id"] for row in first.json()] == [oats, cheese]
    assert [row["editable"] for row in first.json()] == [True, True]
    assert same.status_code == 304
    assert same.content == b""
    assert same.headers["etag"] == etag

    # Другой человек видит тот же каталог, но править его не может — метка у него своя.
    seen = await client.get(CATALOG, headers={**viewer.headers, "If-None-Match": etag})
    assert seen.status_code == 200
    assert [row["editable"] for row in seen.json()] == [False, False]

    edited = await put_product(client, author, {**COTTAGE_CHEESE, "kcal": 130}, cheese)
    assert edited.status_code == 200
    after_edit = await client.get(CATALOG, headers={**author.headers, "If-None-Match": etag})
    assert after_edit.status_code == 200
    assert {row["id"]: row["kcal"] for row in after_edit.json()}[cheese] == 130

    deleted = await client.delete(f"/api/products/{oats}", headers=author.headers)
    assert deleted.status_code == 204
    after_delete = await client.get(
        CATALOG, headers={**author.headers, "If-None-Match": after_edit.headers["etag"]}
    )
    assert [row["id"] for row in after_delete.json()] == [cheese]


async def test_recent_days_hold_two_weeks_of_own_diary(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    product = await add_product(client, user)
    today = datetime.now(ZoneInfo("Europe/Moscow")).date()
    await add_entry(client, user, product, 100, day=today)
    await add_entry(client, user, product, 200, day=today - timedelta(days=13))
    await add_entry(client, user, product, 300, day=today - timedelta(days=14))
    await add_entry(client, other, product, 400, day=today)
    water = await client.put(
        f"/api/diary/water/{uuid.uuid7()}",
        headers=user.headers,
        json={"local_date": today.isoformat(), "amount_ml": 250},
    )
    assert water.status_code == 201

    response = await client.get("/api/diary/recent", headers=user.headers)

    assert response.status_code == 200
    days = response.json()
    assert [day["local_date"] for day in days] == [
        (today - timedelta(days=back)).isoformat() for back in range(14)
    ]
    single = await client.get(
        "/api/diary", params={"date": today.isoformat()}, headers=user.headers
    )
    assert days[0] == single.json()
    assert days[0]["totals"]["kcal"] == 121
    assert days[0]["water"]["total_ml"] == 250
    assert days[13]["totals"]["kcal"] == 242


async def test_all_measurements_come_whole_newest_first(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    weight, waist = await metric_id(client, user), await metric_id(client, user, "waist")
    await put_measurement(client, user, reading(weight, value=74.0, **days_ago(800)))
    await put_measurement(client, user, reading(weight, value=72.4))
    await put_measurement(client, user, reading(waist, value=86, unit="cm", **days_ago(1)))
    await put_measurement(client, other, reading(await metric_id(client, other), value=90))

    response = await client.get(MEASUREMENTS, headers=user.headers)

    assert response.status_code == 200
    rows = response.json()
    assert [row["value"] for row in rows] == [72.4, 86.0, 74.0]
    # Каждый замер — такой же, как в истории своего вида.
    assert [row for row in rows if row["metric_id"] == weight] == await history(
        client, user, weight
    )


async def test_all_measurements_answer_304_until_they_change(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user, other = await make_user(), await make_user()
    weight = await metric_id(client, user)
    record_id = str(uuid.uuid7())
    await put_measurement(client, user, reading(weight), record_id)

    first = await client.get(MEASUREMENTS, headers=user.headers)
    etag = first.headers["etag"]
    same = await client.get(MEASUREMENTS, headers={**user.headers, "If-None-Match": etag})
    foreign = await client.get(MEASUREMENTS, headers={**other.headers, "If-None-Match": etag})

    assert same.status_code == 304
    assert same.content == b""
    assert same.headers["etag"] == etag
    # Метка своя у каждого: чужой ответ не выдать за свой.
    assert (foreign.status_code, foreign.json()) == (200, [])

    async def changed(previous: str) -> str:
        response = await client.get(
            MEASUREMENTS, headers={**user.headers, "If-None-Match": previous}
        )
        assert response.status_code == 200
        return response.headers["etag"]

    await put_measurement(client, user, reading(weight, value=71.9), record_id)
    after_edit = await changed(etag)
    await put_measurement(client, user, reading(weight, value=73.1, **days_ago(2)))
    after_add = await changed(after_edit)
    deleted = await client.delete(f"/api/measurements/{record_id}", headers=user.headers)
    assert deleted.status_code == 204
    await changed(after_add)
