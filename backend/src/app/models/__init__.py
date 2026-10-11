"""Все модели импортируются здесь, чтобы Alembic видел их в метаданных."""

from app.models.auth import Invite, LoginFailure, PasswordReset, RefreshToken
from app.models.error_report import ErrorReport, ErrorSource
from app.models.measurement import Measurement
from app.models.nutrition import (
    BarcodeMiss,
    FoodEntry,
    Meal,
    NutritionGoal,
    Product,
    preset_meals,
)
from app.models.user import Language, Role, Sex, UnitSystem, User

__all__ = [
    "BarcodeMiss",
    "ErrorReport",
    "ErrorSource",
    "FoodEntry",
    "Invite",
    "Language",
    "LoginFailure",
    "Meal",
    "Measurement",
    "NutritionGoal",
    "PasswordReset",
    "Product",
    "RefreshToken",
    "Role",
    "Sex",
    "UnitSystem",
    "User",
    "preset_meals",
]
