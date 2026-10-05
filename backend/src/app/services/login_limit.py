"""Ограничение частоты входа: неудачные попытки считаются по адресу почты и по IP."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import LoginFailure


def _keys(email: str, ip: str | None) -> dict[str, int]:
    settings = get_settings()
    keys = {f"email:{email}": settings.login_max_failures_per_email}
    if ip:
        keys[f"ip:{ip}"] = settings.login_max_failures_per_ip
    return keys


async def seconds_until_allowed(db: AsyncSession, email: str, ip: str | None) -> int:
    """0 — вход разрешён; иначе через сколько секунд можно пробовать снова."""
    window = timedelta(minutes=get_settings().login_window_minutes)
    now = datetime.now(UTC)
    wait = 0
    for key, limit in _keys(email, ip).items():
        count, oldest = (
            await db.execute(
                select(func.count(), func.min(LoginFailure.attempted_at)).where(
                    LoginFailure.key == key, LoginFailure.attempted_at > now - window
                )
            )
        ).one()
        if count >= limit:
            wait = max(wait, int((oldest + window - now).total_seconds()) + 1)
    return wait


async def record_failure(db: AsyncSession, email: str, ip: str | None) -> None:
    window = timedelta(minutes=get_settings().login_window_minutes)
    await db.execute(
        delete(LoginFailure).where(LoginFailure.attempted_at <= datetime.now(UTC) - window)
    )
    db.add_all(LoginFailure(key=key) for key in _keys(email, ip))


async def clear_failures(db: AsyncSession, email: str) -> None:
    await db.execute(delete(LoginFailure).where(LoginFailure.key == f"email:{email}"))
