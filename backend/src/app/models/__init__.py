"""Все модели импортируются здесь, чтобы Alembic видел их в метаданных."""

from app.models.auth import Invite, LoginFailure, PasswordReset, RefreshToken
from app.models.measurement import Measurement
from app.models.user import Language, Role, Sex, UnitSystem, User

__all__ = [
    "Invite",
    "Language",
    "LoginFailure",
    "Measurement",
    "PasswordReset",
    "RefreshToken",
    "Role",
    "Sex",
    "UnitSystem",
    "User",
]
