from datetime import UTC, datetime
from uuid import UUID, uuid7

from fastapi import APIRouter, Response, status
from fastapi.exceptions import RequestValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.exercises import CATALOG
from app.models import Exercise
from app.schemas import (
    ExerciseIn,
    ExerciseListOut,
    ExerciseOut,
    ExercisePresetIn,
    PresetExerciseOut,
    RecordId,
)

router = APIRouter(tags=["exercises"])

_IN_LIST_ORDER = (Exercise.position, Exercise.created_at)


@router.get("/exercises")
async def list_exercises(user: CurrentUser, db: SessionDep) -> ExerciseListOut:
    rows = await db.scalars(
        select(Exercise).where(Exercise.user_id == user.id).order_by(*_IN_LIST_ORDER)
    )
    return ExerciseListOut(
        exercises=[ExerciseOut.of(exercise) for exercise in rows],
        catalog=[PresetExerciseOut.of(exercise) for exercise in CATALOG.values()],
    )


async def _next_position(db: AsyncSession, user_id: UUID) -> int:
    last = await db.scalar(select(func.max(Exercise.position)).where(Exercise.user_id == user_id))
    return 0 if last is None else last + 1


@router.post("/exercises/presets")
async def add_preset_exercise(
    body: ExercisePresetIn, user: CurrentUser, db: SessionDep
) -> ExerciseOut:
    """Ставит штатное упражнение в список пользователя: заводит его или возвращает
    убранное.

    Штатное упражнение у пользователя одно, поэтому повтор запроса ничего не дублирует.
    Новое встаёт в конец списка, возвращённое — на прежнее место.
    """
    statement = insert(Exercise).values(
        id=uuid7(),
        user_id=user.id,
        preset=body.preset,
        kind=CATALOG[body.preset].kind,
        position=await _next_position(db, user.id),
    )
    statement = statement.on_conflict_do_update(
        index_elements=[Exercise.user_id, Exercise.preset],
        index_where=Exercise.preset.is_not(None),
        set_={"archived_at": None, "updated_at": func.now()},
    )
    exercise = (await db.scalars(statement.returning(Exercise))).one()
    await db.commit()
    return ExerciseOut.of(exercise)


async def _own_exercise(db: AsyncSession, exercise_id: UUID, user_id: UUID) -> Exercise | None:
    """Упражнение пользователя; чужое неотличимо от несуществующего (инвариант I5)."""
    exercise = await db.get(Exercise, exercise_id, with_for_update=True)
    if exercise is not None and exercise.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return exercise


@router.put(
    "/exercises/{exercise_id}",
    responses={201: {"model": ExerciseOut}, **error_responses(404)},
)
async def save_exercise(
    exercise_id: RecordId,
    body: ExerciseIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> ExerciseOut:
    """Добавляет в список пользователя своё упражнение или меняет у своего название и
    мышцы: повтор запроса не плодит дубли (ADR 0002). Убранное упражнение этим же
    запросом возвращается в список. Новое встаёт в конец списка. Штатное этим запросом
    не меняется.
    """
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    exercise = await _own_exercise(db, exercise_id, user_id)
    if exercise is None:
        exercise = Exercise(
            id=exercise_id,
            user_id=user_id,
            name=body.name,
            kind=body.kind,
            position=await _next_position(db, user_id),
        )
        db.add(exercise)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего упражнения либо отказ, если оно чужое.
            await db.rollback()
            exercise = await _own_exercise(db, exercise_id, user_id)
    if exercise is None or exercise.preset is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    if exercise.kind != body.kind:
        # Записанные подходы имеют смысл только в прежнем виде.
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("body", "kind"),
                    "msg": "kind of an exercise cannot be changed",
                    "input": None,
                }
            ]
        )
    exercise.name = body.name
    exercise.own_muscles = [muscle.value for muscle in body.muscles]
    exercise.archived_at = None
    await db.commit()
    return ExerciseOut.of(exercise)


@router.delete(
    "/exercises/{exercise_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_exercise(exercise_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    """Убирает упражнение из списка. Записанное по нему остаётся: вернув упражнение в
    список, пользователь получает и его историю."""
    exercise = await _own_exercise(db, exercise_id, user.id)
    if exercise is None or exercise.archived_at is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    exercise.archived_at = datetime.now(UTC)
    await db.commit()
