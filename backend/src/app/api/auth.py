from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import User
from app.schemas import (
    InviteInfo,
    LoginIn,
    PasswordChangeIn,
    PasswordResetIn,
    PasswordResetInfo,
    RegisterIn,
    SessionOut,
    TokenIn,
    UserOut,
)
from app.security.passwords import hash_password, verify_password
from app.services import links, login_limit, sessions
from app.services.sessions import IssuedSession

COOKIE_NAME = "life_refresh"
# Cookie уходит только на эндпоинты авторизации, остальному API он не нужен.
COOKIE_PATH = "/api/auth"

# Открытые эндпоинты: вход, регистрация по приглашению, обновление и сброс.
public = APIRouter(prefix="/auth", tags=["auth"])
# Эндпоинты, которым нужен вошедший пользователь.
private = APIRouter(prefix="/auth", tags=["auth"])

RefreshCookie = Annotated[str | None, Cookie(alias=COOKIE_NAME)]


def _open_session(response: Response, issued: IssuedSession) -> SessionOut:
    response.set_cookie(
        COOKIE_NAME,
        issued.refresh_token,
        expires=issued.refresh_expires_at,
        path=COOKIE_PATH,
        httponly=True,
        secure=True,
        samesite="strict",
    )
    return SessionOut(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        user=UserOut.model_validate(issued.user),
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(
        COOKIE_NAME, path=COOKIE_PATH, httponly=True, secure=True, samesite="strict"
    )


@public.post("/invite/check", responses=error_responses(404))
async def check_invite(body: TokenIn, db: SessionDep) -> InviteInfo:
    invite = await links.find_valid_invite(db, body.token)
    if invite is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.INVITE_INVALID)
    return InviteInfo(role=invite.role, expires_at=invite.expires_at)


@public.post("/register", status_code=status.HTTP_201_CREATED, responses=error_responses(404, 409))
async def register(body: RegisterIn, response: Response, db: SessionDep) -> SessionOut:
    invite = await links.find_valid_invite(db, body.token, lock=True)
    if invite is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.INVITE_INVALID)

    now = datetime.now(UTC)
    user = User(
        email=body.email,
        password_hash=await hash_password(body.password),
        display_name=body.display_name,
        role=invite.role,
        language=body.language,
        timezone=body.timezone,
        disclaimer_accepted_at=now,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as error:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.EMAIL_TAKEN) from error
    invite.used_at = now
    invite.used_by = user.id

    issued = sessions.start_session(db, user)
    await db.commit()
    return _open_session(response, issued)


@public.post("/login", responses=error_responses(401, 429))
async def login(body: LoginIn, request: Request, response: Response, db: SessionDep) -> SessionOut:
    ip = request.client.host if request.client else None
    wait = await login_limit.seconds_until_allowed(db, body.email, ip)
    if wait:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            ErrorCode.TOO_MANY_ATTEMPTS,
            headers={"Retry-After": str(wait)},
        )

    user = await db.scalar(select(User).where(User.email == body.email))
    if not await verify_password(body.password, user.password_hash if user else None) or not user:
        await login_limit.record_failure(db, body.email, ip)
        await db.commit()
        # Один ответ на «нет такого адреса» и «не тот пароль»: по нему адреса не перебрать.
        raise ApiError(status.HTTP_401_UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS)

    await login_limit.clear_failures(db, body.email)
    issued = sessions.start_session(db, user)
    await db.commit()
    return _open_session(response, issued)


@public.post("/refresh", response_model=SessionOut, responses=error_responses(401))
async def refresh(
    response: Response, db: SessionDep, refresh_token: RefreshCookie = None
) -> SessionOut | JSONResponse:
    issued = await sessions.rotate(db, refresh_token) if refresh_token else None
    # Фиксируем и при отказе: отзыв семейства при переиспользовании должен сохраниться.
    await db.commit()
    if issued is None:
        denied = JSONResponse(
            {"detail": ErrorCode.NOT_AUTHENTICATED.value}, status.HTTP_401_UNAUTHORIZED
        )
        _clear_cookie(denied)
        return denied
    return _open_session(response, issued)


@public.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response, db: SessionDep, refresh_token: RefreshCookie = None) -> None:
    if refresh_token:
        await sessions.end_session(db, refresh_token)
        await db.commit()
    _clear_cookie(response)


@public.post("/password-reset/check", responses=error_responses(404))
async def check_password_reset(body: TokenIn, db: SessionDep) -> PasswordResetInfo:
    reset = await links.find_valid_password_reset(db, body.token)
    if reset is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.RESET_INVALID)
    user = await db.get_one(User, reset.user_id)
    return PasswordResetInfo(display_name=user.display_name, expires_at=reset.expires_at)


@public.post(
    "/password-reset", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404)
)
async def reset_password(body: PasswordResetIn, db: SessionDep) -> None:
    reset = await links.find_valid_password_reset(db, body.token, lock=True)
    if reset is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.RESET_INVALID)
    user = await db.get_one(User, reset.user_id)
    user.password_hash = await hash_password(body.new_password)
    reset.used_at = datetime.now(UTC)
    # Пароль сбрасывают, когда он забыт или утёк: все прежние сессии закрываются.
    await sessions.end_all_sessions(db, user.id)
    await login_limit.clear_failures(db, user.email)
    await db.commit()


@private.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(user: CurrentUser, response: Response, db: SessionDep) -> None:
    await sessions.end_all_sessions(db, user.id)
    await db.commit()
    _clear_cookie(response)


@private.post("/password", responses=error_responses(400))
async def change_password(
    body: PasswordChangeIn, user: CurrentUser, response: Response, db: SessionDep
) -> SessionOut:
    if not await verify_password(body.current_password, user.password_hash):
        raise ApiError(status.HTTP_400_BAD_REQUEST, ErrorCode.WRONG_PASSWORD)
    user.password_hash = await hash_password(body.new_password)
    # Остальные устройства выходят; текущее получает новую сессию.
    await sessions.end_all_sessions(db, user.id)
    issued = sessions.start_session(db, user)
    await db.commit()
    return _open_session(response, issued)
