"""Список видов замеров пользователя: штатные, рекомендуемые и свои."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import MakeUser
from tests.measurements import (
    RECOMMENDED,
    STARTING,
    add_metric,
    add_preset,
    list_metrics,
    metric_id,
    put_metric,
    remove_metric,
)
from tests.test_auth import issue_invite, registration

pytestmark = pytest.mark.anyio


def names(listing: dict[str, Any], *, archived: bool = False) -> list[str]:
    """Что стоит в списке (или убрано из него): код штатного вида или название своего."""
    return [
        metric["preset"] or metric["name"]
        for metric in listing["metrics"]
        if metric["archived"] is archived
    ]


# --- Список -----------------------------------------------------------------------------


async def test_new_user_starts_with_the_four_metrics(client: AsyncClient, db: AsyncSession) -> None:
    session = await client.post("/api/auth/register", json=registration(await issue_invite(db)))
    headers = {"Authorization": f"Bearer {session.json()['access_token']}"}

    listing = (await client.get("/api/metrics", headers=headers)).json()

    assert names(listing) == list(STARTING)
    assert listing["available"] == list(RECOMMENDED)


async def test_list_describes_units_and_ranges(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    body_fat = (await add_preset(client, account, "body_fat")).json()["id"]
    wrist = await add_metric(client, account, "Запястье", "length")

    listing = await list_metrics(client, account)

    described = [
        {key: value for key, value in metric.items() if key != "id"}
        for metric in listing["metrics"]
    ]
    assert described == [
        {
            "preset": "weight",
            "name": None,
            "quantity": "mass",
            "unit": "kg",
            "min_value": 2,
            "max_value": 500,
            "archived": False,
        },
        {
            "preset": "neck",
            "name": None,
            "quantity": "length",
            "unit": "cm",
            "min_value": 15,
            "max_value": 80,
            "archived": False,
        },
        {
            "preset": "waist",
            "name": None,
            "quantity": "length",
            "unit": "cm",
            "min_value": 30,
            "max_value": 250,
            "archived": False,
        },
        {
            "preset": "hips",
            "name": None,
            "quantity": "length",
            "unit": "cm",
            "min_value": 30,
            "max_value": 250,
            "archived": False,
        },
        {
            "preset": "body_fat",
            "name": None,
            "quantity": "percent",
            "unit": "percent",
            "min_value": 1,
            "max_value": 75,
            "archived": False,
        },
        {
            "preset": None,
            "name": "Запястье",
            "quantity": "length",
            "unit": "cm",
            "min_value": 0.1,
            "max_value": 300,
            "archived": False,
        },
    ]
    assert [metric["id"] for metric in listing["metrics"]][-2:] == [body_fat, wrist]


# --- Штатные виды -----------------------------------------------------------------------


async def test_recommended_metric_is_added_to_the_end_of_the_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    response = await add_preset(client, account, "biceps")

    assert response.status_code == 200
    assert response.json()["preset"] == "biceps"
    assert uuid.UUID(response.json()["id"]).version == 7
    listing = await list_metrics(client, account)
    assert names(listing) == [*STARTING, "biceps"]
    assert "biceps" not in listing["available"]


async def test_adding_a_preset_twice_keeps_one(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    first = await add_preset(client, account, "calf")
    again = await add_preset(client, account, "calf")
    starting = await add_preset(client, account, "weight")

    assert first.json() == again.json()
    assert starting.json()["id"] == await metric_id(client, account)
    assert names(await list_metrics(client, account)) == [*STARTING, "calf"]


async def test_removed_preset_is_offered_again_and_returns_to_its_place(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    neck = await metric_id(client, account, "neck")

    removed = await remove_metric(client, account, neck)
    listing = await list_metrics(client, account)

    assert removed.status_code == 204
    assert names(listing) == ["weight", "waist", "hips"]
    assert names(listing, archived=True) == ["neck"]
    assert listing["available"] == ["neck", *RECOMMENDED]

    returned = await add_preset(client, account, "neck")

    assert returned.json()["id"] == neck
    assert names(await list_metrics(client, account)) == list(STARTING)


@pytest.mark.parametrize("body", [{"preset": "ankle"}, {}, {"preset": "calf", "name": "Икра"}])
async def test_unknown_preset_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    account = await make_user()

    response = await client.post("/api/metrics/presets", headers=account.headers, json=body)

    assert response.status_code == 422
    assert names(await list_metrics(client, account)) == list(STARTING)


# --- Свои виды --------------------------------------------------------------------------


async def test_own_metric_is_created_with_the_client_id(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())

    response = await put_metric(client, account, "  Бицепс левый ", "length", record_id)

    assert response.status_code == 201
    assert response.json() == {
        "id": record_id,
        "preset": None,
        "name": "Бицепс левый",
        "quantity": "length",
        "unit": "cm",
        "min_value": 0.1,
        "max_value": 300,
        "archived": False,
    }
    assert names(await list_metrics(client, account)) == [*STARTING, "Бицепс левый"]


async def test_repeated_request_does_not_duplicate_an_own_metric(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = str(uuid.uuid7())

    first = await put_metric(client, account, record_id=record_id)
    again = await put_metric(client, account, record_id=record_id)

    assert (first.status_code, again.status_code) == (201, 200)
    assert names(await list_metrics(client, account)) == [*STARTING, "Запястье"]


async def test_own_metric_can_be_renamed(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    record_id = await add_metric(client, account, "Запястье")

    response = await put_metric(client, account, "Запястье правое", record_id=record_id)

    assert response.status_code == 200
    assert response.json()["name"] == "Запястье правое"
    assert names(await list_metrics(client, account)) == [*STARTING, "Запястье правое"]


async def test_removed_own_metric_returns_with_the_request_that_created_it(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    first = await add_metric(client, account, "Запястье")
    await add_metric(client, account, "Лодыжка")
    await remove_metric(client, account, first)
    assert names(await list_metrics(client, account), archived=True) == ["Запястье"]

    returned = await put_metric(client, account, "Запястье", record_id=first)

    assert returned.status_code == 200
    assert names(await list_metrics(client, account)) == [*STARTING, "Запястье", "Лодыжка"]


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "quantity": "length"},
        {"name": "   ", "quantity": "length"},
        {"name": "я" * 41, "quantity": "length"},
        {"name": "Пульс", "quantity": "rate"},
        {"name": "Пульс"},
        {"quantity": "length"},
        {"name": "Запястье", "quantity": "length", "preset": "neck"},
    ],
)
async def test_invalid_own_metric_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    account = await make_user()

    response = await client.put(f"/api/metrics/{uuid.uuid7()}", headers=account.headers, json=body)

    assert response.status_code == 422
    assert names(await list_metrics(client, account)) == list(STARTING)


async def test_preset_cannot_be_renamed(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    neck = await metric_id(client, account, "neck")

    response = await put_metric(client, account, "Шея по-своему", record_id=neck)

    assert response.status_code == 404
    assert names(await list_metrics(client, account)) == list(STARTING)


def lose_the_first_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Имитирует гонку: первая проверка «есть ли вид» отвечает «нет», хотя он уже создан."""
    from app.api import measurements

    real = measurements._own_metric  # pyright: ignore[reportPrivateUsage]
    calls = 0

    async def racing(*args: Any) -> Any:
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real(*args)

    monkeypatch.setattr(measurements, "_own_metric", racing)


async def test_parallel_creation_with_one_id_ends_as_a_rename(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = await make_user()
    record_id = await add_metric(client, account, "Запястье")
    lose_the_first_lookup(monkeypatch)

    response = await put_metric(client, account, "Запястье правое", record_id=record_id)

    assert response.status_code == 200
    assert names(await list_metrics(client, account)) == [*STARTING, "Запястье правое"]


async def test_parallel_creation_cannot_take_over_a_foreign_id(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, stranger = await make_user(), await make_user()
    record_id = await add_metric(client, owner, "Запястье")
    lose_the_first_lookup(monkeypatch)

    response = await put_metric(client, stranger, "Подменено", record_id=record_id)

    assert response.status_code == 404
    assert names(await list_metrics(client, owner)) == [*STARTING, "Запястье"]
    assert names(await list_metrics(client, stranger)) == list(STARTING)


# --- Удаление из списка -----------------------------------------------------------------


async def test_metric_is_removed_from_the_list_once(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    record_id = await add_metric(client, account)

    removed = await remove_metric(client, account, record_id)
    again = await remove_metric(client, account, record_id)
    unknown = await remove_metric(client, account, str(uuid.uuid7()))

    assert (removed.status_code, again.status_code, unknown.status_code) == (204, 404, 404)
    assert names(await list_metrics(client, account)) == list(STARTING)


async def test_every_metric_can_be_removed(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()

    for metric in (await list_metrics(client, account))["metrics"]:
        assert (await remove_metric(client, account, metric["id"])).status_code == 204

    listing = await list_metrics(client, account)
    assert names(listing) == []
    assert listing["available"] == [*STARTING, *RECOMMENDED]


# --- Изоляция ---------------------------------------------------------------------------


async def test_users_have_lists_of_their_own(client: AsyncClient, make_user: MakeUser) -> None:
    owner, stranger = await make_user(), await make_user()
    wrist = await add_metric(client, owner, "Запястье")
    await add_preset(client, owner, "chest")

    rename = await put_metric(client, stranger, "Подменено", record_id=wrist)
    remove = await remove_metric(client, stranger, wrist)

    assert (rename.status_code, remove.status_code) == (404, 404)
    assert names(await list_metrics(client, owner)) == [*STARTING, "Запястье", "chest"]
    assert names(await list_metrics(client, stranger)) == list(STARTING)
    assert "chest" in (await list_metrics(client, stranger))["available"]
