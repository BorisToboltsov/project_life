from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import COOKIE_NAME
from app.config import get_settings
from app.models import Invite, PasswordReset, RefreshToken, Role, User
from app.security.tokens import hash_token
from app.services import links
from tests.conftest import PASSWORD, MakeUser, new_client

pytestmark = pytest.mark.anyio


async def issue_invite(db: AsyncSession, role: Role = Role.USER) -> str:
    _, token = links.create_invite(db, role)
    await db.commit()
    return token


def registration(token: str, **overrides: object) -> dict[str, object]:
    return {
        "token": token,
        "email": "Anna@Example.com",
        "password": PASSWORD,
        "display_name": "  Анна  ",
        "language": "ru",
        "timezone": "Europe/Moscow",
        "accept_disclaimer": True,
        **overrides,
    }


async def refresh_with(token: str) -> Response:
    """Обновление с заданным cookie — так предъявляют украденный или устаревший токен."""
    async with new_client() as other:
        return await other.post("/api/auth/refresh", headers={"Cookie": f"{COOKIE_NAME}={token}"})


def cookie(client: AsyncClient) -> str:
    value = client.cookies.get(COOKIE_NAME)
    assert value is not None
    return value


# --- Регистрация по приглашению ---------------------------------------------------------


async def test_register_creates_user_and_opens_session(
    client: AsyncClient, db: AsyncSession
) -> None:
    token = await issue_invite(db)

    response = await client.post("/api/auth/register", json=registration(token))

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "anna@example.com"
    assert body["user"]["display_name"] == "Анна"
    assert body["user"]["role"] == "user"
    assert body["user"]["unit_system"] == "metric"
    assert body["expires_in"] == 15 * 60
    me = await client.get("/api/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    user = await db.scalar(select(User))
    assert user is not None
    assert user.disclaimer_accepted_at is not None
    assert user.password_hash != PASSWORD


async def test_register_grants_the_role_of_the_invite(
    client: AsyncClient, db: AsyncSession
) -> None:
    token = await issue_invite(db, Role.ADMIN)

    response = await client.post("/api/auth/register", json=registration(token))

    assert response.json()["user"]["role"] == "admin"


async def test_invite_works_once(client: AsyncClient, db: AsyncSession) -> None:
    token = await issue_invite(db)
    await client.post("/api/auth/register", json=registration(token))

    second = await client.post(
        "/api/auth/register", json=registration(token, email="other@example.com")
    )

    assert second.status_code == 404
    assert second.json() == {"detail": "invite_invalid"}


async def test_expired_invite_is_rejected(client: AsyncClient, db: AsyncSession) -> None:
    token = await issue_invite(db)
    await db.execute(update(Invite).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    await db.commit()

    check = await client.post("/api/auth/invite/check", json={"token": token})
    response = await client.post("/api/auth/register", json=registration(token))

    assert check.status_code == 404
    assert response.status_code == 404


async def test_invite_check_describes_a_valid_invite(client: AsyncClient, db: AsyncSession) -> None:
    token = await issue_invite(db, Role.ADMIN)

    response = await client.post("/api/auth/invite/check", json={"token": token})

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


async def test_register_with_taken_email_keeps_the_invite(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    await make_user(email="anna@example.com")
    token = await issue_invite(db)

    taken = await client.post("/api/auth/register", json=registration(token))
    retry = await client.post(
        "/api/auth/register", json=registration(token, email="anna2@example.com")
    )

    assert taken.status_code == 409
    assert taken.json() == {"detail": "email_taken"}
    assert retry.status_code == 201


@pytest.mark.parametrize(
    "overrides",
    [
        {"accept_disclaimer": False},
        {"password": "short"},
        {"email": "not-an-email"},
        {"timezone": "Mars/Olympus"},
        {"language": "de"},
        {"display_name": "   "},
        {"role": "admin"},
    ],
)
async def test_register_validates_input(
    client: AsyncClient, db: AsyncSession, overrides: dict[str, object]
) -> None:
    token = await issue_invite(db)

    response = await client.post("/api/auth/register", json=registration(token, **overrides))

    assert response.status_code == 422


# --- Вход -------------------------------------------------------------------------------


async def test_login_returns_token_and_sets_hardened_cookie(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    response = await client.post(
        "/api/auth/login", json={"email": account.email.upper(), "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["user"]["id"] == account.id
    set_cookie = response.headers["set-cookie"]
    assert f"{COOKIE_NAME}=" in set_cookie
    for attribute in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api/auth"):
        assert attribute in set_cookie


async def test_login_gives_one_answer_for_wrong_password_and_unknown_email(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    wrong = await client.post(
        "/api/auth/login", json={"email": account.email, "password": "wrong password"}
    )
    unknown = await client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
    )

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "invalid_credentials"}
    assert "set-cookie" not in wrong.headers


async def test_login_is_blocked_after_too_many_failures(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    limit = get_settings().login_max_failures_per_email
    for _ in range(limit):
        await client.post("/api/auth/login", json={"email": account.email, "password": "nope"})

    blocked = await client.post(
        "/api/auth/login", json={"email": account.email, "password": PASSWORD}
    )

    assert blocked.status_code == 429
    assert blocked.json() == {"detail": "too_many_attempts"}
    assert 0 < int(blocked.headers["retry-after"]) <= 15 * 60 + 1


async def test_successful_login_resets_the_failure_count(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    limit = get_settings().login_max_failures_per_email
    credentials = {"email": account.email, "password": PASSWORD}
    for _ in range(limit - 1):
        await client.post("/api/auth/login", json={**credentials, "password": "nope"})
    await client.post("/api/auth/login", json=credentials)
    for _ in range(limit - 1):
        await client.post("/api/auth/login", json={**credentials, "password": "nope"})

    response = await client.post("/api/auth/login", json=credentials)

    assert response.status_code == 200


# --- Обновление и ротация ---------------------------------------------------------------


async def login(client: AsyncClient, account_email: str) -> str:
    response = await client.post(
        "/api/auth/login", json={"email": account_email, "password": PASSWORD}
    )
    assert response.status_code == 200
    return cookie(client)


async def test_refresh_rotates_the_token(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    first = await login(client, account.email)

    response = await client.post("/api/auth/refresh")

    assert response.status_code == 200
    assert response.json()["user"]["id"] == account.id
    assert cookie(client) != first


async def test_refresh_without_cookie_is_rejected(client: AsyncClient) -> None:
    response = await client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.json() == {"detail": "not_authenticated"}


async def test_replayed_token_after_grace_revokes_the_whole_family(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    account = await make_user()
    stolen = await login(client, account.email)
    await client.post("/api/auth/refresh")
    current = cookie(client)
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(stolen))
        .values(rotated_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    await db.commit()

    replay = await refresh_with(stolen)
    owner = await refresh_with(current)

    assert replay.status_code == 401
    assert "Max-Age=0" in replay.headers["set-cookie"]
    # Сервер не знает, кто из двоих вор, — выходят оба.
    assert owner.status_code == 401


async def test_replayed_token_within_grace_is_treated_as_a_retry(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    first = await login(client, account.email)
    await client.post("/api/auth/refresh")
    current = cookie(client)

    retry = await refresh_with(first)
    owner = await refresh_with(current)

    assert retry.status_code == 200
    assert owner.status_code == 200


async def test_expired_refresh_token_is_rejected(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    account = await make_user()
    await login(client, account.email)
    await db.execute(
        update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await db.commit()

    response = await client.post("/api/auth/refresh")

    assert response.status_code == 401


async def test_unknown_refresh_token_is_rejected() -> None:
    response = await refresh_with("made-up-token")

    assert response.status_code == 401


# --- Выход ------------------------------------------------------------------------------


async def test_logout_ends_this_session_only(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    phone = await login(client, account.email)
    async with new_client() as laptop_client:
        laptop = await login(laptop_client, account.email)

    response = await client.post("/api/auth/logout")

    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert (await refresh_with(phone)).status_code == 401
    assert (await refresh_with(laptop)).status_code == 200


async def test_logout_without_session_is_harmless(client: AsyncClient) -> None:
    response = await client.post("/api/auth/logout")

    assert response.status_code == 204


async def test_logout_all_ends_every_session(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    phone = await login(client, account.email)
    async with new_client() as laptop_client:
        laptop = await login(laptop_client, account.email)

    response = await client.post("/api/auth/logout-all", headers=account.headers)

    assert response.status_code == 204
    assert (await refresh_with(phone)).status_code == 401
    assert (await refresh_with(laptop)).status_code == 401


# --- Смена и сброс пароля ---------------------------------------------------------------


async def test_change_password_keeps_this_device_and_signs_out_others(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()
    async with new_client() as laptop_client:
        laptop = await login(laptop_client, account.email)
    await login(client, account.email)
    new_password = "a brand new passphrase"

    response = await client.post(
        "/api/auth/password",
        headers=account.headers,
        json={"current_password": PASSWORD, "new_password": new_password},
    )

    assert response.status_code == 200
    assert (await client.post("/api/auth/refresh")).status_code == 200
    assert (await refresh_with(laptop)).status_code == 401
    old = await client.post("/api/auth/login", json={"email": account.email, "password": PASSWORD})
    new = await client.post(
        "/api/auth/login", json={"email": account.email, "password": new_password}
    )
    assert old.status_code == 401
    assert new.status_code == 200


async def test_change_password_requires_the_current_one(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    response = await client.post(
        "/api/auth/password",
        headers=account.headers,
        json={"current_password": "not my password", "new_password": "a brand new passphrase"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "wrong_password"}


async def issue_reset(db: AsyncSession, user_id: str) -> str:
    user = await db.get_one(User, user_id)
    _, token = links.create_password_reset(db, user)
    await db.commit()
    return token


async def test_password_reset_sets_password_and_ends_sessions(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    account = await make_user()
    session = await login(client, account.email)
    token = await issue_reset(db, account.id)
    new_password = "a brand new passphrase"

    check = await client.post("/api/auth/password-reset/check", json={"token": token})
    response = await client.post(
        "/api/auth/password-reset", json={"token": token, "new_password": new_password}
    )

    assert check.json()["display_name"] == "Тестовый пользователь"
    assert response.status_code == 204
    assert (await refresh_with(session)).status_code == 401
    login_response = await client.post(
        "/api/auth/login", json={"email": account.email, "password": new_password}
    )
    assert login_response.status_code == 200


async def test_password_reset_link_works_once(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    account = await make_user()
    token = await issue_reset(db, account.id)
    body = {"token": token, "new_password": "a brand new passphrase"}
    await client.post("/api/auth/password-reset", json=body)

    second = await client.post("/api/auth/password-reset", json=body)

    assert second.status_code == 404
    assert second.json() == {"detail": "reset_invalid"}


async def test_expired_password_reset_is_rejected(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    account = await make_user()
    token = await issue_reset(db, account.id)
    await db.execute(
        update(PasswordReset).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await db.commit()

    check = await client.post("/api/auth/password-reset/check", json={"token": token})
    response = await client.post(
        "/api/auth/password-reset", json={"token": token, "new_password": "a brand new passphrase"}
    )

    assert check.status_code == 404
    assert response.status_code == 404


# --- Access-токен -----------------------------------------------------------------------


async def test_garbage_access_token_is_rejected(client: AsyncClient) -> None:
    response = await client.get("/api/me", headers={"Authorization": "Bearer not.a.jwt"})

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_token_of_a_deleted_user_is_rejected(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    account = await make_user()
    await db.delete(await db.get_one(User, account.id))
    await db.commit()

    response = await client.get("/api/me", headers=account.headers)

    assert response.status_code == 401
