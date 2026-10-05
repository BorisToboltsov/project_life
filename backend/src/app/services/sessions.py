"""Сессии: access-JWT и refresh-токен с ротацией и детекцией переиспользования (ADR 0001)."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid7

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import RefreshToken, User
from app.security.tokens import create_access_token, hash_token, new_token

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IssuedSession:
    user: User
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime


def _issue(db: AsyncSession, user: User, family_id: UUID) -> IssuedSession:
    refresh_token = new_token()
    expires_at = datetime.now(UTC) + timedelta(days=get_settings().refresh_ttl_days)
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family_id,
            token_hash=hash_token(refresh_token),
            expires_at=expires_at,
        )
    )
    access_token, expires_in = create_access_token(user.id)
    return IssuedSession(user, access_token, expires_in, refresh_token, expires_at)


def start_session(db: AsyncSession, user: User) -> IssuedSession:
    """Новый вход — новое семейство токенов."""
    return _issue(db, user, uuid7())


async def _revoke_family(db: AsyncSession, family_id: UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


async def rotate(db: AsyncSession, refresh_token: str) -> IssuedSession | None:
    """Меняет refresh-токен на новый. None — токен не годится, нужен повторный вход."""
    # Блокировка строки выстраивает параллельные обновления одним токеном в очередь.
    stored = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(refresh_token))
        .with_for_update()
    )
    now = datetime.now(UTC)
    if stored is None or stored.revoked_at is not None or stored.expires_at <= now:
        return None

    if stored.rotated_at is not None:
        grace = timedelta(seconds=get_settings().refresh_grace_seconds)
        if now - stored.rotated_at > grace:
            # Погашенный токен предъявлен снова: его украли либо у владельца, либо у вора.
            logger.warning("refresh token reuse detected, family %s revoked", stored.family_id)
            await _revoke_family(db, stored.family_id)
            return None
        # Повтор сразу после ротации (потерянный ответ, вторая вкладка) — выдаём ещё одного
        # преемника в том же семействе.
    else:
        stored.rotated_at = now

    user = await db.get_one(User, stored.user_id)
    return _issue(db, user, stored.family_id)


async def end_session(db: AsyncSession, refresh_token: str) -> None:
    """Выход на одном устройстве: отзывает семейство предъявленного токена."""
    family_id = await db.scalar(
        select(RefreshToken.family_id).where(RefreshToken.token_hash == hash_token(refresh_token))
    )
    if family_id is not None:
        await _revoke_family(db, family_id)


async def end_all_sessions(db: AsyncSession, user_id: UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
