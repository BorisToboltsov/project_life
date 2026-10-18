"""Все модели импортируются здесь, чтобы Alembic видел их в метаданных."""

from app.models.auth import Invite, LoginFailure, PasswordReset, RefreshToken
from app.models.error_report import ErrorReport, ErrorSource
from app.models.exercise import Exercise
from app.models.fitness import FitnessResult
from app.models.measurement import Measurement, Metric, preset_metrics
from app.models.nutrition import (
    BarcodeMiss,
    FoodEntry,
    Meal,
    NutritionGoal,
    Product,
    WaterIntake,
    preset_meals,
)
from app.models.user import Language, Role, Sex, UnitSystem, User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet
from app.models.workout_group import WorkoutGroup, WorkoutGroupExercise

__all__ = [
    "BarcodeMiss",
    "ErrorReport",
    "ErrorSource",
    "Exercise",
    "FitnessResult",
    "FoodEntry",
    "Invite",
    "Language",
    "LoginFailure",
    "Meal",
    "Measurement",
    "Metric",
    "NutritionGoal",
    "PasswordReset",
    "Product",
    "RefreshToken",
    "Role",
    "Sex",
    "UnitSystem",
    "User",
    "WaterIntake",
    "Workout",
    "WorkoutExercise",
    "WorkoutGroup",
    "WorkoutGroupExercise",
    "WorkoutSet",
    "preset_meals",
    "preset_metrics",
]
