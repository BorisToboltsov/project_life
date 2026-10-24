"""Short-lived, path-scoped permission for a browser's streaming download."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from fastapi import Response

from app.config import get_settings

COOKIE_NAME = "life_download"
COOKIE_PATH = "/api/studies/"
TTL = 120


def permit(response: Response, user_id: UUID, study_id: UUID) -> None:
    now = datetime.now(UTC)
    token = jwt.encode(  # pyright: ignore[reportUnknownMemberType]
        {
            "sub": str(user_id),
            "aud": f"/api/studies/{study_id}/original",
            "iat": now,
            "exp": now + timedelta(seconds=TTL),
        },
        get_settings().jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=TTL,
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )


def owner(token: str, path: str) -> UUID | None:
    try:
        payload = jwt.decode(  # pyright: ignore[reportUnknownMemberType]
            token,
            get_settings().jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=path,
            options={"require": ["sub", "exp", "aud"]},
        )
        return UUID(payload["sub"])
    except jwt.InvalidTokenError, ValueError:
        return None


def clear(response: Response) -> None:
    response.delete_cookie(
        COOKIE_NAME, path=COOKIE_PATH, secure=True, httponly=True, samesite="strict"
    )
