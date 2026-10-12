import pytest

from app.exercises import (
    CATALOG,
    CardioField,
    ExerciseKind,
    ExercisePreset,
    Muscle,
    cardio_fields,
)


def test_catalog_describes_every_preset() -> None:
    assert set(CATALOG) == set(ExercisePreset)
    assert all(exercise.code == code for code, exercise in CATALOG.items())
    assert len(CATALOG) == 40


def test_muscles_of_an_exercise_are_named_once() -> None:
    for exercise in CATALOG.values():
        named = exercise.muscles + exercise.secondary
        assert len(set(named)) == len(named), exercise.code


def test_only_an_activity_has_no_muscles() -> None:
    without = [code for code, exercise in CATALOG.items() if not exercise.muscles]

    assert without == [ExercisePreset.TABLE_TENNIS]


def test_every_muscle_is_trained_by_some_exercise() -> None:
    primary = {muscle for exercise in CATALOG.values() for muscle in exercise.muscles}

    assert primary == set(Muscle) - {Muscle.FOREARMS, Muscle.TRAPS}


def test_only_cardio_has_cardio_fields() -> None:
    for exercise in CATALOG.values():
        assert bool(exercise.cardio_fields) == (exercise.kind == ExerciseKind.CARDIO), exercise.code


@pytest.mark.parametrize(
    ("preset", "expected"),
    [
        (ExercisePreset.TREADMILL_WALK, (CardioField.DISTANCE, CardioField.INCLINE)),
        (ExercisePreset.ELLIPTICAL, (CardioField.DISTANCE, CardioField.LEVEL)),
        (ExercisePreset.EXERCISE_BIKE, (CardioField.DISTANCE, CardioField.LEVEL)),
        (ExercisePreset.ROWING_MACHINE, (CardioField.DISTANCE, CardioField.LEVEL)),
    ],
)
def test_machine_decides_what_a_cardio_set_records(
    preset: ExercisePreset, expected: tuple[CardioField, ...]
) -> None:
    assert cardio_fields(preset, CATALOG[preset].kind) == expected


def test_own_cardio_records_every_field() -> None:
    assert cardio_fields(None, ExerciseKind.CARDIO) == tuple(CardioField)
    assert cardio_fields(None, ExerciseKind.WEIGHT_REPS) == ()


def test_kinds_of_the_exercises_the_list_was_built_around() -> None:
    kinds = {code.value: exercise.kind.value for code, exercise in CATALOG.items()}

    assert kinds["deadlift"] == "weight_reps"
    assert kinds["crunch"] == "reps"
    assert kinds["plank"] == "time"
    assert kinds["table_tennis"] == "time"
    assert kinds["treadmill_walk"] == "cardio"
