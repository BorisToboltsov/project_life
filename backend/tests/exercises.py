"""Общие шаги тестов упражнений: список пользователя, штатное упражнение, своё."""

import uuid
from typing import Any

from httpx import AsyncClient, Response

from tests.conftest import Account


async def list_exercises(client: AsyncClient, account: Account) -> dict[str, Any]:
    response = await client.get("/api/exercises", headers=account.headers)
    assert response.status_code == 200
    return response.json()


def names(listing: dict[str, Any], *, archived: bool = False) -> list[str]:
    """Что стоит в списке (или убрано из него): код штатного упражнения или название
    своего."""
    return [
        exercise["preset"] or exercise["name"]
        for exercise in listing["exercises"]
        if exercise["archived"] is archived
    ]


async def add_preset(client: AsyncClient, account: Account, preset: str) -> Response:
    return await client.post(
        "/api/exercises/presets", headers=account.headers, json={"preset": preset}
    )


async def put_exercise(
    client: AsyncClient,
    account: Account,
    name: str = "Тяга гантели к поясу",
    kind: str = "weight_reps",
    muscles: list[str] | None = None,
    record_id: str | None = None,
) -> Response:
    return await client.put(
        f"/api/exercises/{record_id or uuid.uuid7()}",
        headers=account.headers,
        json={"name": name, "kind": kind, "muscles": muscles or []},
    )


async def add_exercise(
    client: AsyncClient,
    account: Account,
    name: str = "Тяга гантели к поясу",
    kind: str = "weight_reps",
    muscles: list[str] | None = None,
) -> str:
    response = await put_exercise(client, account, name, kind, muscles)
    assert response.status_code == 201
    return response.json()["id"]


async def remove_exercise(client: AsyncClient, account: Account, record_id: str) -> Response:
    return await client.delete(f"/api/exercises/{record_id}", headers=account.headers)
