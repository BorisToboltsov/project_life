import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Invite
from tests.conftest import MakeUser

pytestmark = pytest.mark.anyio


async def test_admin_lists_users(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(admin=True)
    member = await make_user()

    response = await client.get("/api/admin/users", headers=admin.headers)

    assert response.status_code == 200
    assert [(user["id"], user["role"]) for user in response.json()] == [
        (admin.id, "admin"),
        (member.id, "user"),
    ]
    assert set(response.json()[0]) == {"id", "email", "display_name", "role", "created_at"}


async def test_invite_token_is_shown_once_and_registers_a_user(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(admin=True)

    created = await client.post(
        "/api/admin/invites", headers=admin.headers, json={"note": "  для мамы  "}
    )
    listed = await client.get("/api/admin/invites", headers=admin.headers)

    assert created.status_code == 201
    invite = created.json()
    assert invite["role"] == "user"
    assert invite["note"] == "для мамы"
    assert [item["id"] for item in listed.json()] == [invite["id"]]
    assert "token" not in listed.json()[0]
    stored = await db.scalar(select(Invite))
    assert stored is not None
    assert stored.created_by is not None
    assert invite["token"] not in stored.token_hash

    registered = await client.post(
        "/api/auth/register",
        json={
            "token": invite["token"],
            "email": "mama@example.com",
            "password": "correct horse battery",
            "display_name": "Мама",
            "language": "ru",
            "timezone": "Europe/Moscow",
            "accept_disclaimer": True,
        },
    )
    assert registered.status_code == 201
    # Использованное приглашение уходит из списка действующих.
    assert (await client.get("/api/admin/invites", headers=admin.headers)).json() == []


async def test_admin_can_invite_another_admin(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(admin=True)

    response = await client.post(
        "/api/admin/invites", headers=admin.headers, json={"role": "admin"}
    )

    assert response.json()["role"] == "admin"
    assert response.json()["note"] is None


async def test_revoked_invite_stops_working(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(admin=True)
    invite = (await client.post("/api/admin/invites", headers=admin.headers, json={})).json()

    revoked = await client.delete(f"/api/admin/invites/{invite['id']}", headers=admin.headers)
    again = await client.delete(f"/api/admin/invites/{invite['id']}", headers=admin.headers)
    check = await client.post("/api/auth/invite/check", json={"token": invite["token"]})

    assert revoked.status_code == 204
    assert again.status_code == 404
    assert check.status_code == 404


async def test_admin_issues_password_reset_link(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(admin=True)
    member = await make_user()

    created = await client.post(
        f"/api/admin/users/{member.id}/password-reset", headers=admin.headers
    )
    missing = await client.post(
        f"/api/admin/users/{uuid.uuid4()}/password-reset", headers=admin.headers
    )

    assert created.status_code == 200
    assert missing.status_code == 404
    reset = await client.post(
        "/api/auth/password-reset",
        json={"token": created.json()["token"], "new_password": "a brand new passphrase"},
    )
    assert reset.status_code == 204
