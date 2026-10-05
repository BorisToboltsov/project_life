"""Одноразовые ссылки от администратора: приглашение и сброс пароля."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Invite, PasswordReset, Role, User
from app.security.tokens import hash_token, new_token


def create_invite(
    db: AsyncSession, role: Role, note: str | None = None, created_by: UUID | None = None
) -> tuple[Invite, str]:
    token = new_token()
    invite = Invite(
        token_hash=hash_token(token),
        role=role,
        note=note,
        created_by=created_by,
        expires_at=datetime.now(UTC) + timedelta(days=get_settings().invite_ttl_days),
    )
    db.add(invite)
    return invite, token


async def find_valid_invite(db: AsyncSession, token: str, *, lock: bool = False) -> Invite | None:
    query = select(Invite).where(
        Invite.token_hash == hash_token(token),
        Invite.used_at.is_(None),
        Invite.expires_at > datetime.now(UTC),
    )
    return await db.scalar(query.with_for_update() if lock else query)


def create_password_reset(db: AsyncSession, user: User) -> tuple[PasswordReset, str]:
    token = new_token()
    reset = PasswordReset(
        token_hash=hash_token(token),
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=get_settings().password_reset_ttl_hours),
    )
    db.add(reset)
    return reset, token


async def find_valid_password_reset(
    db: AsyncSession, token: str, *, lock: bool = False
) -> PasswordReset | None:
    query = select(PasswordReset).where(
        PasswordReset.token_hash == hash_token(token),
        PasswordReset.used_at.is_(None),
        PasswordReset.expires_at > datetime.now(UTC),
    )
    return await db.scalar(query.with_for_update() if lock else query)
