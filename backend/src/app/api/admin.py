from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.deps import AdminUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import Invite, User
from app.schemas import (
    AdminUserOut,
    InviteCreated,
    InviteCreateIn,
    InviteOut,
    PasswordResetCreated,
)
from app.services import links

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
async def list_users(db: SessionDep) -> list[AdminUserOut]:
    users = await db.scalars(select(User).order_by(User.created_at))
    return [AdminUserOut.model_validate(user) for user in users]


@router.post("/users/{user_id}/password-reset", responses=error_responses(404))
async def create_password_reset(user_id: UUID, db: SessionDep) -> PasswordResetCreated:
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    reset, token = links.create_password_reset(db, user)
    await db.commit()
    return PasswordResetCreated(token=token, expires_at=reset.expires_at)


@router.get("/invites")
async def list_invites(db: SessionDep) -> list[InviteOut]:
    """Действующие приглашения: не использованные и не истёкшие."""
    invites = await db.scalars(
        select(Invite)
        .where(Invite.used_at.is_(None), Invite.expires_at > datetime.now(UTC))
        .order_by(Invite.created_at.desc())
    )
    return [InviteOut.model_validate(invite) for invite in invites]


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(body: InviteCreateIn, admin: AdminUser, db: SessionDep) -> InviteCreated:
    invite, token = links.create_invite(db, body.role, body.note or None, created_by=admin.id)
    await db.commit()
    await db.refresh(invite)
    return InviteCreated(
        id=invite.id,
        role=invite.role,
        note=invite.note,
        created_at=invite.created_at,
        expires_at=invite.expires_at,
        token=token,
    )


@router.delete(
    "/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404)
)
async def revoke_invite(invite_id: UUID, db: SessionDep) -> None:
    invite = await db.get(Invite, invite_id)
    if invite is None or invite.used_at is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(invite)
    await db.commit()
