from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from tests.conftest import MakeUser

pytestmark = pytest.mark.anyio


async def test_profile_is_returned_without_secrets(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    response = await client.get("/api/me", headers=account.headers)

    assert response.status_code == 200
    assert response.json() == {
        "id": account.id,
        "email": account.email,
        "display_name": "Тестовый пользователь",
        "role": "user",
        "language": "ru",
        "timezone": "Europe/Moscow",
        "unit_system": "metric",
        "sex": None,
        "birth_date": None,
        "height_cm": None,
    }


async def test_profile_update_changes_only_sent_fields(
    client: AsyncClient, make_user: MakeUser
) -> None:
    account = await make_user()

    response = await client.patch(
        "/api/me",
        headers=account.headers,
        json={
            "display_name": "Анна",
            "language": "en",
            "timezone": "Asia/Tokyo",
            "unit_system": "imperial",
            "sex": "female",
            "birth_date": "1990-05-17",
            "height_cm": 168.5,
        },
    )
    partial = await client.patch("/api/me", headers=account.headers, json={"height_cm": 169})

    assert response.status_code == 200
    assert partial.json() == {
        "id": account.id,
        "email": account.email,
        "display_name": "Анна",
        "role": "user",
        "language": "en",
        "timezone": "Asia/Tokyo",
        "unit_system": "imperial",
        "sex": "female",
        "birth_date": "1990-05-17",
        "height_cm": 169.0,
    }


async def test_optional_fields_can_be_cleared(client: AsyncClient, make_user: MakeUser) -> None:
    account = await make_user()
    await client.patch(
        "/api/me",
        headers=account.headers,
        json={"sex": "male", "birth_date": "1985-01-01", "height_cm": 180},
    )

    response = await client.patch(
        "/api/me",
        headers=account.headers,
        json={"sex": None, "birth_date": None, "height_cm": None},
    )

    body = response.json()
    assert (body["sex"], body["birth_date"], body["height_cm"]) == (None, None, None)


def tomorrow_plus(days: int) -> str:
    return (datetime.now(UTC).date() + timedelta(days=1 + days)).isoformat()


@pytest.mark.parametrize(
    "patch",
    [
        {"timezone": "Mars/Olympus"},
        {"height_cm": 20},
        {"height_cm": 300},
        {"birth_date": "1850-01-01"},
        {"birth_date": tomorrow_plus(1)},
        {"sex": "other"},
        {"unit_system": "stone"},
        {"display_name": ""},
        # Обязательные поля нельзя обнулить.
        {"display_name": None},
        {"language": None},
        {"timezone": None},
        {"unit_system": None},
        # Поля, которые профиль менять не вправе.
        {"role": "admin"},
        {"email": "new@example.com"},
        {"password_hash": "x"},
    ],
)
async def test_profile_update_validates_input(
    client: AsyncClient, make_user: MakeUser, patch: dict[str, object]
) -> None:
    account = await make_user()

    response = await client.patch("/api/me", headers=account.headers, json=patch)

    assert response.status_code == 422
    assert (await client.get("/api/me", headers=account.headers)).json()["role"] == "user"
