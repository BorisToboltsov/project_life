from typing import Annotated

from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db import SessionDep
from app.errors import ApiError, ErrorCode
from app.models import Role, User
from app.security.tokens import decode_access_token

_bearer = HTTPBearer(auto_error=False)


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: SessionDep,
) -> User:
    user_id = decode_access_token(credentials.credentials) if credentials else None
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            ErrorCode.NOT_AUTHENTICATED,
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != Role.ADMIN:
        raise ApiError(status.HTTP_403_FORBIDDEN, ErrorCode.FORBIDDEN)
    return user


AdminUser = Annotated[User, Depends(require_admin)]
