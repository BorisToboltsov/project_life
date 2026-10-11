"""Все модели импортируются здесь, чтобы Alembic видел их в метаданных."""

from app.models.auth import Invite, LoginFailure, PasswordReset, RefreshToken
from app.models.error_report import ErrorReport, ErrorSource
from app.models.measurement import Measurement
from app.models.nutrition import FoodEntry, NutritionGoal, Product
from app.models.user import Language, Role, Sex, UnitSystem, User

__all__ = [
    "ErrorReport",
    "ErrorSource",
    "FoodEntry",
    "Invite",
    "Language",
    "LoginFailure",
    "Measurement",
    "NutritionGoal",
    "PasswordReset",
    "Product",
    "RefreshToken",
    "Role",
    "Sex",
    "UnitSystem",
    "User",
]
