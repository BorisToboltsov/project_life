"""Гейт изоляции (инвариант I5): эндпоинт закрыт, пока явно не объявлен открытым.

Каждый маршрут приложения обязан попасть ровно в одну группу:
- открытый — перечислен в PUBLIC поимённо;
- административный — под /api/admin, обычному пользователю отвечает 403;
- пользовательский — без входа отвечает 401, а если принимает идентификатор записи,
  то обязан иметь сценарий в OWNERSHIP: чужая запись неотличима от несуществующей;
- общий — запись каталога из SHARED: её видят все вошедшие, а меняет автор или
  администратор, остальным — 403.
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


async def _measurement_body(client: AsyncClient, owner: Account) -> dict[str, Any]:
    now = datetime.now(UTC)
    listed = await client.get("/api/metrics", headers=owner.headers)
    return {
        "metric_id": listed.json()["metrics"][0]["id"],
        "value": 72.4,
        "unit": "kg",
        "measured_at": now.isoformat(),
        "local_date": now.date().isoformat(),
    }


async def _own_measurement(client: AsyncClient, owner: Account) -> Probe:
    body = await _measurement_body(client, owner)
    path = f"/api/measurements/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, body)


async def _delete_measurement(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_measurement(client, owner)).path)


async def _own_metric(client: AsyncClient, owner: Account) -> Probe:
    path = f"/api/metrics/{uuid.uuid7()}"
    created = await client.put(
        path, headers=owner.headers, json={"name": "Запястье", "quantity": "length"}
    )
    assert created.status_code == 201
    return Probe(path, {"name": "Подменено", "quantity": "length"})


async def _delete_metric(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_metric(client, owner)).path)


async def _own_exercise(client: AsyncClient, owner: Account) -> Probe:
    path = f"/api/exercises/{uuid.uuid7()}"
    body = {"name": "Тяга гантели к поясу", "kind": "weight_reps", "muscles": ["lats"]}
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, {**body, "name": "Подменено"})


async def _delete_exercise(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_exercise(client, owner)).path)


async def _exercise_rest(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_exercise(client, owner)).path + "/rest", {"rest_seconds": 45})


async def _exercise_progress(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_exercise(client, owner)).path + "/progress")


async def _own_group(client: AsyncClient, owner: Account) -> Probe:
    from tests.workout_groups import create_group

    path, body = await create_group(client, owner)
    return Probe(path, body)


async def _delete_group(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_group(client, owner)).path)


async def _start_group(client: AsyncClient, owner: Account) -> Probe:
    from tests.workout_groups import start_body

    return Probe((await _own_group(client, owner)).path + "/start", start_body())


async def _own_workout(client: AsyncClient, owner: Account) -> Probe:
    now = datetime.now(UTC)
    body = {"started_at": now.isoformat(), "local_date": now.date().isoformat()}
    path = f"/api/workouts/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, body)


async def _get_workout(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_workout(client, owner)).path)


async def _finish_workout(client: AsyncClient, owner: Account) -> Probe:
    return Probe(
        (await _own_workout(client, owner)).path + "/finish",
        {"finished_at": datetime.now(UTC).isoformat()},
    )


async def _repeat_workout(client: AsyncClient, owner: Account) -> Probe:
    path = (await _own_workout(client, owner)).path
    finished = await client.post(
        path + "/finish",
        headers=owner.headers,
        json={"finished_at": datetime.now(UTC).isoformat()},
    )
    assert finished.status_code == 200
    now = datetime.now(UTC)
    return Probe(
        path + "/repeat",
        {
            "id": str(uuid.uuid7()),
            "item_ids": [],
            "started_at": now.isoformat(),
            "local_date": now.date().isoformat(),
        },
    )


async def _own_workout_exercise(client: AsyncClient, owner: Account) -> Probe:
    workout = await _own_workout(client, owner)
    exercise = await client.post(
        "/api/exercises/presets", headers=owner.headers, json={"preset": "plank"}
    )
    assert exercise.status_code == 200
    body = {"exercise_id": exercise.json()["id"]}
    path = workout.path + f"/exercises/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, body)


async def _own_workout_set(client: AsyncClient, owner: Account) -> Probe:
    item = await _own_workout_exercise(client, owner)
    body = {"duration_seconds": 60}
    path = item.path + f"/sets/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, body)


async def _delete_workout_set(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_workout_set(client, owner)).path)


async def _delete_workout_exercise(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_workout_exercise(client, owner)).path)


def _product_body() -> dict[str, Any]:
    return {
        "name": "Творог 5 %",
        "unit": "g",
        "kcal": 121,
        "protein_g": 17.2,
        "fat_g": 5,
        "carbs_g": 1.8,
    }


async def _own_product(client: AsyncClient, owner: Account) -> str:
    path = f"/api/products/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=_product_body())
    assert created.status_code == 201
    return path


async def _read_product(client: AsyncClient, owner: Account) -> Probe:
    return Probe(await _own_product(client, owner))


async def _replace_product(client: AsyncClient, owner: Account) -> Probe:
    return Probe(await _own_product(client, owner), {**_product_body(), "name": "Подменено"})


async def _food_entry_body(client: AsyncClient, owner: Account) -> dict[str, Any]:
    product = await _own_product(client, owner)
    today = datetime.now(UTC).date().isoformat()
    day = await client.get("/api/diary", params={"date": today}, headers=owner.headers)
    return {
        "local_date": today,
        "meal_id": day.json()["meals"][0]["id"],
        "product_id": product.rsplit("/", 1)[1],
        "amount": 150,
    }


async def _own_food_entry(client: AsyncClient, owner: Account) -> Probe:
    body = await _food_entry_body(client, owner)
    path = f"/api/diary/entries/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, body)


async def _delete_food_entry(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_food_entry(client, owner)).path)


async def _own_meal(client: AsyncClient, owner: Account) -> Probe:
    path = f"/api/diary/meals/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json={"name": "Полдник"})
    assert created.status_code == 201
    return Probe(path, {"name": "Подменено"})


async def _delete_meal(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_meal(client, owner)).path)


async def _own_water(client: AsyncClient, owner: Account) -> Probe:
    body = {"local_date": datetime.now(UTC).date().isoformat(), "amount_ml": 250}
    path = f"/api/diary/water/{uuid.uuid7()}"
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    return Probe(path, {**body, "amount_ml": 500})


async def _delete_water(client: AsyncClient, owner: Account) -> Probe:
    return Probe((await _own_water(client, owner)).path)


OWNERSHIP: dict[Route, OwnershipCase] = {
    ("PUT", "/api/measurements/{measurement_id}"): _own_measurement,
    ("DELETE", "/api/measurements/{measurement_id}"): _delete_measurement,
    ("PUT", "/api/metrics/{metric_id}"): _own_metric,
    ("DELETE", "/api/metrics/{metric_id}"): _delete_metric,
    ("PUT", "/api/exercises/{exercise_id}"): _own_exercise,
    ("DELETE", "/api/exercises/{exercise_id}"): _delete_exercise,
    ("PUT", "/api/exercises/{exercise_id}/rest"): _exercise_rest,
    ("GET", "/api/exercises/{exercise_id}/progress"): _exercise_progress,
    ("PUT", "/api/workout-groups/{group_id}"): _own_group,
    ("DELETE", "/api/workout-groups/{group_id}"): _delete_group,
    ("POST", "/api/workout-groups/{group_id}/start"): _start_group,
    ("GET", "/api/workouts/{workout_id}"): _get_workout,
    ("PUT", "/api/workouts/{workout_id}"): _own_workout,
    ("DELETE", "/api/workouts/{workout_id}"): _get_workout,
    ("POST", "/api/workouts/{workout_id}/finish"): _finish_workout,
    ("POST", "/api/workouts/{workout_id}/repeat"): _repeat_workout,
    ("PUT", "/api/workouts/{workout_id}/exercises/{item_id}"): _own_workout_exercise,
    ("DELETE", "/api/workouts/{workout_id}/exercises/{item_id}"): _delete_workout_exercise,
    ("PUT", "/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}"): _own_workout_set,
    ("DELETE", "/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}"): _delete_workout_set,
    ("PUT", "/api/diary/entries/{entry_id}"): _own_food_entry,
    ("DELETE", "/api/diary/entries/{entry_id}"): _delete_food_entry,
    ("PUT", "/api/diary/meals/{meal_id}"): _own_meal,
    ("DELETE", "/api/diary/meals/{meal_id}"): _delete_meal,
    ("PUT", "/api/diary/water/{intake_id}"): _own_water,
    ("DELETE", "/api/diary/water/{intake_id}"): _delete_water,
}

# Общий каталог: запись видят все вошедшие, меняет её автор или администратор. Сценарий
# создаёт запись от имени автора; гейт повторяет запрос от имени другого пользователя и
# ждёт 200 на чтение и 403 на изменение.
SHARED: dict[Route, OwnershipCase] = {
    ("GET", "/api/products/{product_id}"): _read_product,
    ("PUT", "/api/products/{product_id}"): _replace_product,
    ("DELETE", "/api/products/{product_id}"): _read_product,
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
WITH_RECORD_ID = [route for route in CLOSED if route not in ADMIN and "{" in route[1]]
OWNED = [route for route in WITH_RECORD_ID if route not in SHARED]


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
    assert set(SHARED) <= set(WITH_RECORD_ID), "в SHARED остались несуществующие маршруты"


@pytest.mark.parametrize(("method", "path"), OWNED)
async def test_foreign_record_looks_missing(
    client: AsyncClient, make_user: MakeUser, method: str, path: str
) -> None:
    owner, stranger = await make_user(), await make_user()
    probe = await OWNERSHIP[method, path](client, owner)

    response = await client.request(method, probe.path, headers=stranger.headers, json=probe.json)

    assert response.status_code == 404, f"{method} {path} отдаёт чужую запись"
    assert response.json() == {"detail": "not_found"}


@pytest.mark.parametrize(("method", "path"), sorted(SHARED))
async def test_shared_record_is_changed_only_by_its_author(
    client: AsyncClient, make_user: MakeUser, method: str, path: str
) -> None:
    author, stranger = await make_user(), await make_user()
    probe = await SHARED[method, path](client, author)
    before = (await client.get(probe.path, headers=author.headers)).json()

    response = await client.request(method, probe.path, headers=stranger.headers, json=probe.json)

    if method == "GET":
        assert response.status_code == 200, f"{method} {path} не отдаёт общую запись"
        assert response.json() == {**before, "editable": False}
    else:
        assert response.status_code == 403, f"{method} {path} даёт менять чужую запись"
        assert response.json() == {"detail": "forbidden"}
    assert (await client.get(probe.path, headers=author.headers)).json() == before


@pytest.mark.parametrize(("method", "path"), OWNED + sorted(SHARED))
async def test_record_id_must_be_a_client_uuid7(
    client: AsyncClient, make_user: MakeUser, method: str, path: str
) -> None:
    """Инвариант I8: ключ пользовательской записи — UUIDv7 от клиента, другой не принимается."""
    owner = await make_user()
    probe = await {**OWNERSHIP, **SHARED}[method, path](client, owner)
    template_parts = path.split("/")
    actual_parts = probe.path.split("/")
    last_key = max(index for index, part in enumerate(template_parts) if part.startswith("{"))
    actual_parts[last_key] = str(uuid.uuid4())
    with_other_version = "/".join(actual_parts)

    response = await client.request(
        method, with_other_version, headers=owner.headers, json=probe.json
    )

    assert response.status_code == 422, f"{method} {path} принимает ключ не версии 7"
