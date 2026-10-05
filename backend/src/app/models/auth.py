from datetime import datetime
from uuid import UUID, uuid7

from sqlalchemy import BigInteger, ForeignKey, Identity, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.user import Role, choice, one_of

# Токены хранятся только как SHA-256: утечка базы не даёт готовых ссылок и сессий.
TOKEN_HASH = String(64)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Все токены одного входа; предъявление погашенного токена отзывает семейство целиком.
    family_id: Mapped[UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(TOKEN_HASH, unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
    rotated_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (one_of("role", Role),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    token_hash: Mapped[str] = mapped_column(TOKEN_HASH, unique=True)
    role: Mapped[Role] = mapped_column(choice(Role))
    note: Mapped[str | None] = mapped_column(String(120))
    # Пусто у приглашения, выпущенного из командной строки.
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    used_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    token_hash: Mapped[str] = mapped_column(TOKEN_HASH, unique=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]


class LoginFailure(Base):
    """Неудачная попытка входа; по ним считается ограничение частоты."""

    __tablename__ = "login_failures"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # `email:<адрес>` или `ip:<адрес>`.
    key: Mapped[str] = mapped_column(String(300), index=True)
    attempted_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
