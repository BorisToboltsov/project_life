import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from pydantic import ValidationError

from app.config import DEV_JWT_SECRET, Settings, get_settings
from app.security.passwords import hash_password, verify_password
from app.security.tokens import create_access_token, decode_access_token, hash_token, new_token


@pytest.mark.anyio
async def test_password_hash_verifies_only_the_right_password() -> None:
    password_hash = await hash_password("correct horse battery")

    assert password_hash.startswith("$argon2id$")
    assert await verify_password("correct horse battery", password_hash)
    assert not await verify_password("wrong", password_hash)


@pytest.mark.anyio
async def test_missing_user_never_verifies() -> None:
    assert not await verify_password("no-such-user", None)


def test_access_token_round_trip() -> None:
    user_id = uuid.uuid7()

    token, expires_in = create_access_token(user_id)

    assert decode_access_token(token) == user_id
    assert expires_in == get_settings().access_ttl_minutes * 60


def sign(payload: dict[str, object], secret: str = DEV_JWT_SECRET) -> str:
    return jwt.encode(payload, secret, algorithm="HS256")  # pyright: ignore[reportUnknownMemberType]


def forged(**claims: object) -> str:
    in_five_minutes = datetime.now(UTC) + timedelta(minutes=5)
    return sign({"sub": str(uuid.uuid7()), "exp": in_five_minutes, **claims})


@pytest.mark.parametrize(
    "token",
    [
        forged(exp=datetime.now(UTC) - timedelta(seconds=1)),
        forged(sub="not-a-uuid"),
        sign({"sub": str(uuid.uuid7())}),
        sign(
            {"sub": str(uuid.uuid7()), "exp": datetime.now(UTC) + timedelta(minutes=5)},
            "another-secret-of-sufficient-length-123",
        ),
        "garbage",
    ],
    ids=["expired", "bad-subject", "no-expiry", "wrong-key", "garbage"],
)
def test_invalid_access_tokens_are_rejected(token: str) -> None:
    assert decode_access_token(token) is None


def test_random_tokens_are_unique_and_stored_hashed() -> None:
    first, second = new_token(), new_token()

    assert first != second
    assert len(first) >= 43
    assert hash_token(first) != first
    assert hash_token(first) == hash_token(first)


def test_production_refuses_to_start_with_the_dev_secret() -> None:
    with pytest.raises(ValidationError, match="LIFE_JWT_SECRET"):
        Settings(environment="prod")
    with pytest.raises(ValidationError, match="LIFE_JWT_SECRET"):
        Settings(environment="prod", jwt_secret="too-short")  # pyright: ignore[reportArgumentType]

    settings = Settings(environment="prod", jwt_secret="x" * 32)  # pyright: ignore[reportArgumentType]
    assert settings.jwt_secret.get_secret_value() == "x" * 32
