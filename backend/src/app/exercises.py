"""Справочник штатных упражнений (ADR 0014).

Что записывает подход, какие мышцы работают и какие поля есть у кардио — задано здесь.
Название, шаги техники и рисунок подбирает интерфейс по коду упражнения.
"""

from dataclasses import dataclass
from enum import StrEnum


class ExerciseKind(StrEnum):
    """Что записывает подход. Задаётся у упражнения один раз."""

    WEIGHT_REPS = "weight_reps"
    # Со своим весом; отягощение — по желанию.
    REPS = "reps"
    TIME = "time"
    # Время и то, что показывает тренажёр: дистанция, наклон, уровень нагрузки.
    CARDIO = "cardio"


class CardioField(StrEnum):
    """Необязательные поля подхода у кардио; время есть всегда."""

    DISTANCE = "distance"
    INCLINE = "incline"
    LEVEL = "level"


class PaceUnit(StrEnum):
    """Как показывать темп кардио — так, как принято на тренажёре. Считается он из времени
    и дистанции подхода и отдельно не хранится."""

    # Минуты на километр; по профилю — на милю.
    PER_KM = "per_km"
    # Километры в час; по профилю — мили в час.
    SPEED = "speed"
    # Время на 500 м, как на гребном тренажёре.
    PER_500M = "per_500m"


class Muscle(StrEnum):
    CHEST = "chest"
    DELTS = "delts"
    BICEPS = "biceps"
    TRICEPS = "triceps"
    FOREARMS = "forearms"
    ABS = "abs"
    OBLIQUES = "obliques"
    TRAPS = "traps"
    LATS = "lats"
    LOWER_BACK = "lower_back"
    GLUTES = "glutes"
    QUADS = "quads"
    HAMSTRINGS = "hamstrings"
    CALVES = "calves"


class ExercisePreset(StrEnum):
    """Штатные упражнения: название, технику и рисунок подбирает интерфейс."""

    ELLIPTICAL = "elliptical"
    TREADMILL_WALK = "treadmill_walk"
    EXERCISE_BIKE = "exercise_bike"
    ROWING_MACHINE = "rowing_machine"
    LAT_PULLDOWN = "lat_pulldown"
    DUMBBELL_BENCH_PRESS = "dumbbell_bench_press"
    SEATED_DUMBBELL_PRESS = "seated_dumbbell_press"
    ROPE_PUSHDOWN = "rope_pushdown"
    SEATED_FRONT_RAISE = "seated_front_raise"
    EZ_BAR_CURL = "ez_bar_curl"
    CRUNCH = "crunch"
    BACK_EXTENSION = "back_extension"
    DEADLIFT = "deadlift"
    LEG_PRESS = "leg_press"
    LEG_EXTENSION = "leg_extension"
    LYING_LEG_CURL = "lying_leg_curl"
    PLANK = "plank"
    GOBLET_SQUAT = "goblet_squat"
    LEVER_ROW = "lever_row"
    LATERAL_OVERHEAD_RAISE = "lateral_overhead_raise"
    HAMMER_CURL = "hammer_curl"
    KETTLEBELL_SWING = "kettlebell_swing"
    RUSSIAN_TWIST = "russian_twist"
    TABLE_TENNIS = "table_tennis"
    BARBELL_SQUAT = "barbell_squat"
    BENCH_PRESS = "bench_press"
    PULL_UP = "pull_up"
    PUSH_UP = "push_up"
    DIP = "dip"
    BARBELL_ROW = "barbell_row"
    OVERHEAD_PRESS = "overhead_press"
    DUMBBELL_LUNGE = "dumbbell_lunge"
    ROMANIAN_DEADLIFT = "romanian_deadlift"
    CALF_RAISE = "calf_raise"
    LATERAL_RAISE = "lateral_raise"
    DUMBBELL_FLY = "dumbbell_fly"
    SEATED_CABLE_ROW = "seated_cable_row"
    FRENCH_PRESS = "french_press"
    HANGING_LEG_RAISE = "hanging_leg_raise"
    GLUTE_BRIDGE = "glute_bridge"


@dataclass(frozen=True)
class ExerciseType:
    code: ExercisePreset
    kind: ExerciseKind
    # Мышцы, которые делают основную работу, и те, что помогают.
    muscles: tuple[Muscle, ...] = ()
    secondary: tuple[Muscle, ...] = ()
    # Только у кардио: что, кроме времени, показывает тренажёр, и в чём он считает темп.
    cardio_fields: tuple[CardioField, ...] = ()
    pace: PaceUnit | None = None


_W, _R, _T, _C = (
    ExerciseKind.WEIGHT_REPS,
    ExerciseKind.REPS,
    ExerciseKind.TIME,
    ExerciseKind.CARDIO,
)
_M = Muscle
_P = ExercisePreset
_WITH_LEVEL = (CardioField.DISTANCE, CardioField.LEVEL)
_WITH_INCLINE = (CardioField.DISTANCE, CardioField.INCLINE)

CATALOG: dict[ExercisePreset, ExerciseType] = {
    exercise.code: exercise
    for exercise in (
        ExerciseType(
            _P.ELLIPTICAL,
            _C,
            (_M.QUADS, _M.GLUTES),
            (_M.HAMSTRINGS, _M.CALVES),
            _WITH_LEVEL,
            PaceUnit.SPEED,
        ),
        ExerciseType(
            _P.TREADMILL_WALK,
            _C,
            (_M.QUADS, _M.GLUTES),
            (_M.CALVES,),
            _WITH_INCLINE,
            PaceUnit.PER_KM,
        ),
        ExerciseType(
            _P.EXERCISE_BIKE,
            _C,
            (_M.QUADS,),
            (_M.GLUTES, _M.CALVES),
            _WITH_LEVEL,
            PaceUnit.SPEED,
        ),
        ExerciseType(
            _P.ROWING_MACHINE,
            _C,
            (_M.LATS, _M.QUADS),
            (_M.BICEPS, _M.LOWER_BACK),
            _WITH_LEVEL,
            PaceUnit.PER_500M,
        ),
        ExerciseType(_P.LAT_PULLDOWN, _W, (_M.LATS,), (_M.BICEPS, _M.DELTS)),
        ExerciseType(_P.DUMBBELL_BENCH_PRESS, _W, (_M.CHEST,), (_M.TRICEPS, _M.DELTS)),
        ExerciseType(_P.SEATED_DUMBBELL_PRESS, _W, (_M.DELTS,), (_M.TRICEPS,)),
        ExerciseType(_P.ROPE_PUSHDOWN, _W, (_M.TRICEPS,)),
        ExerciseType(_P.SEATED_FRONT_RAISE, _W, (_M.DELTS,)),
        ExerciseType(_P.EZ_BAR_CURL, _W, (_M.BICEPS,), (_M.FOREARMS,)),
        ExerciseType(_P.CRUNCH, _R, (_M.ABS,)),
        ExerciseType(_P.BACK_EXTENSION, _R, (_M.LOWER_BACK,), (_M.GLUTES, _M.HAMSTRINGS)),
        ExerciseType(
            _P.DEADLIFT, _W, (_M.HAMSTRINGS, _M.GLUTES, _M.LOWER_BACK), (_M.QUADS, _M.TRAPS)
        ),
        ExerciseType(_P.LEG_PRESS, _W, (_M.QUADS, _M.GLUTES), (_M.HAMSTRINGS,)),
        ExerciseType(_P.LEG_EXTENSION, _W, (_M.QUADS,)),
        ExerciseType(_P.LYING_LEG_CURL, _W, (_M.HAMSTRINGS,), (_M.CALVES,)),
        ExerciseType(_P.PLANK, _T, (_M.ABS,), (_M.LOWER_BACK, _M.DELTS)),
        ExerciseType(_P.GOBLET_SQUAT, _W, (_M.QUADS, _M.GLUTES), (_M.ABS,)),
        ExerciseType(_P.LEVER_ROW, _W, (_M.LATS,), (_M.BICEPS, _M.DELTS)),
        ExerciseType(_P.LATERAL_OVERHEAD_RAISE, _W, (_M.DELTS,), (_M.TRAPS,)),
        ExerciseType(_P.HAMMER_CURL, _W, (_M.BICEPS,), (_M.FOREARMS,)),
        ExerciseType(
            _P.KETTLEBELL_SWING, _W, (_M.GLUTES, _M.HAMSTRINGS), (_M.LOWER_BACK, _M.DELTS)
        ),
        ExerciseType(_P.RUSSIAN_TWIST, _W, (_M.ABS, _M.OBLIQUES)),
        # Не упражнение, а занятие: мышц и техники у него нет.
        ExerciseType(_P.TABLE_TENNIS, _T),
        ExerciseType(
            _P.BARBELL_SQUAT,
            _W,
            (_M.QUADS, _M.GLUTES),
            (_M.HAMSTRINGS, _M.ABS, _M.LOWER_BACK),
        ),
        ExerciseType(_P.BENCH_PRESS, _W, (_M.CHEST,), (_M.TRICEPS, _M.DELTS)),
        ExerciseType(_P.PULL_UP, _R, (_M.LATS,), (_M.BICEPS, _M.FOREARMS)),
        ExerciseType(_P.PUSH_UP, _R, (_M.CHEST,), (_M.TRICEPS, _M.DELTS, _M.ABS)),
        ExerciseType(_P.DIP, _R, (_M.TRICEPS, _M.CHEST), (_M.DELTS,)),
        ExerciseType(_P.BARBELL_ROW, _W, (_M.LATS,), (_M.BICEPS, _M.LOWER_BACK, _M.TRAPS)),
        ExerciseType(_P.OVERHEAD_PRESS, _W, (_M.DELTS,), (_M.TRICEPS, _M.TRAPS)),
        ExerciseType(_P.DUMBBELL_LUNGE, _W, (_M.QUADS, _M.GLUTES), (_M.HAMSTRINGS,)),
        ExerciseType(_P.ROMANIAN_DEADLIFT, _W, (_M.HAMSTRINGS, _M.GLUTES), (_M.LOWER_BACK,)),
        ExerciseType(_P.CALF_RAISE, _W, (_M.CALVES,)),
        ExerciseType(_P.LATERAL_RAISE, _W, (_M.DELTS,)),
        ExerciseType(_P.DUMBBELL_FLY, _W, (_M.CHEST,), (_M.DELTS,)),
        ExerciseType(_P.SEATED_CABLE_ROW, _W, (_M.LATS,), (_M.BICEPS, _M.TRAPS)),
        ExerciseType(_P.FRENCH_PRESS, _W, (_M.TRICEPS,)),
        ExerciseType(_P.HANGING_LEG_RAISE, _R, (_M.ABS,), (_M.FOREARMS,)),
        ExerciseType(_P.GLUTE_BRIDGE, _R, (_M.GLUTES,), (_M.HAMSTRINGS,)),
    )
}


def cardio_fields(preset: ExercisePreset | None, kind: ExerciseKind) -> tuple[CardioField, ...]:
    """Какие поля, кроме времени, есть у подхода. Что показывает тренажёр своего кардио,
    приложение не знает — у него доступны все."""
    if kind != ExerciseKind.CARDIO:
        return ()
    return tuple(CardioField) if preset is None else CATALOG[preset].cardio_fields


def pace_unit(preset: ExercisePreset | None, kind: ExerciseKind) -> PaceUnit | None:
    """В чём показывать темп. Что за тренажёр у своего кардио, приложение не знает — темп
    у него в минутах на километр, как у бега."""
    if kind != ExerciseKind.CARDIO:
        return None
    return PaceUnit.PER_KM if preset is None else CATALOG[preset].pace
