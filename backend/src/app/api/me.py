from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.schemas import ProfilePatch, UserOut

router = APIRouter(prefix="/me", tags=["profile"])


@router.get("")
async def read_profile(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("")
async def update_profile(body: ProfilePatch, user: CurrentUser, db: SessionDep) -> UserOut:
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    return UserOut.model_validate(user)
