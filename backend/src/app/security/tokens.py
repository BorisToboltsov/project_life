import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from app.config import get_settings

_ALGORITHM = "HS256"


def new_token() -> str:
    """Случайный токен для refresh-cookie, приглашения или сброса пароля."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    # Токен случаен и длинен, медленный хэш ему не нужен.
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: UUID) -> tuple[str, int]:
    """Возвращает JWT и срок его жизни в секундах."""
    settings = get_settings()
    ttl = timedelta(minutes=settings.access_ttl_minutes)
    now = datetime.now(UTC)
    # У PyJWT тип ключа описан через необязательную cryptography — отсюда «unknown».
    token = jwt.encode(  # pyright: ignore[reportUnknownMemberType]
        {"sub": str(user_id), "iat": now, "exp": now + ttl},
        settings.jwt_secret.get_secret_value(),
        algorithm=_ALGORITHM,
    )
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> UUID | None:
    try:
        payload = jwt.decode(  # pyright: ignore[reportUnknownMemberType]
            token,
            get_settings().jwt_secret.get_secret_value(),
            algorithms=[_ALGORITHM],
            options={"require": ["sub", "exp"]},
        )
        return UUID(payload["sub"])
    except jwt.InvalidTokenError, ValueError:
        return None
