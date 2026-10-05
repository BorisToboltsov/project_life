"""Гейт изоляции (инвариант I5): эндпоинт закрыт, пока явно не объявлен открытым.

Каждый маршрут приложения обязан попасть ровно в одну группу:
- открытый — перечислен в PUBLIC поимённо;
- административный — под /api/admin, обычному пользователю отвечает 403;
- пользовательский — без входа отвечает 401, а если принимает идентификатор записи,
  то обязан иметь сценарий в OWNERSHIP: чужая запись неотличима от несуществующей.
"""

import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.routing import APIRoute, iter_route_contexts
from httpx import AsyncClient

from app.main import app
from tests.conftest import Account, MakeUser

pytestmark = pytest.mark.anyio

Route = tuple[str, str]

PUBLIC: set[Route] = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/invite/check"),
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/password-reset/check"),
    ("POST", "/api/auth/password-reset"),
}


@dataclass(frozen=True)
class Probe:
    """Запрос к записи владельца, который гейт повторит от имени другого пользователя."""

    path: str
    json: dict[str, Any] | None = None


# Сценарий владения: создаёт запись от имени владельца и описывает запрос к ней.
# Гейт выполняет этот запрос от имени другого пользователя и ждёт 404.
OwnershipCase = Callable[[AsyncClient, Account], Awaitable[Probe]]


def _measurement_body() -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "metric": "weight",
        "value": 72.4,
        "unit": "kg",
        "measured_at": now.isoformat(),
        "local_date": now.date().isoformat(),
    }


async def _own_measurement(client: AsyncClient, owner: Account) -> str:
    path = f"/api/measurements/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=_measurement_body())
    assert created.status_code == 201
    return path


async def _replace_measurement(client: AsyncClient, owner: Account) -> Probe:
    return Probe(await _own_measurement(client, owner), _measurement_body())


async def _delete_measurement(client: AsyncClient, owner: Account) -> Probe:
    return Probe(await _own_measurement(client, owner))


OWNERSHIP: dict[Route, OwnershipCase] = {
    ("PUT", "/api/measurements/{measurement_id}"): _replace_measurement,
    ("DELETE", "/api/measurements/{measurement_id}"): _delete_measurement,
}


def all_routes() -> list[Route]:
    return sorted(
        (method, context.path)
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, APIRoute) and context.path
        for method in (context.methods or set()) - {"HEAD", "OPTIONS"}
    )


CLOSED = [route for route in all_routes() if route not in PUBLIC]
ADMIN = [route for route in CLOSED if route[1].startswith("/api/admin/")]
OWNED = [route for route in CLOSED if route not in ADMIN and "{" in route[1]]


def concrete(path: str) -> str:
    return re.sub(r"{[^}]+}", str(uuid.uuid4()), path)


def test_public_list_names_only_existing_routes() -> None:
    assert set(all_routes()) >= PUBLIC


def test_route_listing_agrees_with_openapi() -> None:
    """Список маршрутов сверяется со схемой: пустой или неполный обход не пройдёт молча."""
    documented = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }

    assert documented
    assert set(all_routes()) >= documented


def test_there_are_closed_routes_to_check() -> None:
    assert CLOSED
    assert ADMIN


@pytest.mark.parametrize(("method", "path"), CLOSED)
async def test_closed_route_rejects_anonymous(client: AsyncClient, method: str, path: str) -> None:
    response = await client.request(method, concrete(path))

    assert response.status_code == 401, f"{method} {path} доступен без входа"
    assert response.json() == {"detail": "not_authenticated"}


@pytest.mark.parametrize(("method", "path"), ADMIN)
async def test_admin_route_rejects_regular_user(
    client: AsyncClient, make_user: MakeUser, method: str, path: str
) -> None:
    member = await make_user()

    response = await client.request(method, concrete(path), headers=member.headers)

    assert response.status_code == 403, f"{method} {path} доступен обычному пользователю"
    assert response.json() == {"detail": "forbidden"}


def test_every_route_with_a_record_id_has_an_ownership_case() -> None:
    missing = [route for route in OWNED if route not in OWNERSHIP]

    assert not missing, f"нет сценария владения для: {missing}"
    assert set(OWNERSHIP) <= set(OWNED), "в OWNERSHIP остались несуществующие маршруты"


@pytest.mark.parametrize(("method", "path"), OWNED)
async def test_foreign_record_looks_missing(
    client: AsyncClient, make_user: MakeUser, method: str, path: str
) -> None:
    owner, stranger = await make_user(), await make_user()
    probe = await OWNERSHIP[method, path](client, owner)

    response = await client.request(method, probe.path, headers=stranger.headers, json=probe.json)

    assert response.status_code == 404, f"{method} {path} отдаёт чужую запись"
    assert response.json() == {"detail": "not_found"}


@pytest.mark.parametrize(("method", "path"), OWNED)
async def test_record_id_must_be_a_client_uuid7(
    client: AsyncClient, make_user: MakeUser, method: str, path: str
) -> None:
    """Инвариант I8: ключ пользовательской записи — UUIDv7 от клиента, другой не принимается."""
    owner = await make_user()
    probe = await OWNERSHIP[method, path](client, owner)
    with_other_version = re.sub(r"[^/]+$", str(uuid.uuid4()), probe.path)

    response = await client.request(
        method, with_other_version, headers=owner.headers, json=probe.json
    )

    assert response.status_code == 422, f"{method} {path} принимает ключ не версии 7"
