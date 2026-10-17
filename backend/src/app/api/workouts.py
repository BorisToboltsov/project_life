"""Журнал тренировок: время, порядок упражнений и подходы."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Response, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.exercises import CardioField, ExerciseKind
from app.models import Exercise, Workout, WorkoutExercise, WorkoutSet
from app.schemas import (
    ExerciseLatestOut,
    ExerciseOut,
    RecordId,
    WorkoutDetailOut,
    WorkoutExerciseIn,
    WorkoutExerciseOut,
    WorkoutFinishIn,
    WorkoutIn,
    WorkoutListOut,
    WorkoutOut,
    WorkoutRecentOut,
    WorkoutRepeatIn,
    WorkoutSetIn,
    WorkoutSetOut,
)

router = APIRouter(tags=["workouts"])
_KG_PER_LB = Decimal("0.45359237")
_KM_PER_MI = Decimal("1.609344")


def _missing() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)


async def _workout(db: AsyncSession, workout_id: UUID, user_id: UUID) -> Workout:
    row = await db.scalar(
        select(Workout)
        .where(Workout.id == workout_id, Workout.user_id == user_id)
        .with_for_update()
    )
    if row is None:
        raise _missing()
    return row


async def _item(db: AsyncSession, workout_id: UUID, item_id: UUID) -> WorkoutExercise:
    row = await db.scalar(
        select(WorkoutExercise)
        .where(WorkoutExercise.id == item_id, WorkoutExercise.workout_id == workout_id)
        .with_for_update()
    )
    if row is None:
        raise _missing()
    return row


async def workout_counts(db: AsyncSession, workout_id: UUID) -> tuple[int, int]:
    exercise_count = await db.scalar(
        select(func.count())
        .select_from(WorkoutExercise)
        .where(WorkoutExercise.workout_id == workout_id)
    )
    set_count = await db.scalar(
        select(func.count())
        .select_from(WorkoutSet)
        .join(WorkoutExercise)
        .where(WorkoutExercise.workout_id == workout_id)
    )
    return exercise_count or 0, set_count or 0


@router.get("/workouts")
async def list_workouts(user: CurrentUser, db: SessionDep) -> WorkoutListOut:
    rows = await db.scalars(
        select(Workout)
        .where(Workout.user_id == user.id)
        .order_by(Workout.started_at.desc(), Workout.id.desc())
    )
    workouts: list[WorkoutOut] = []
    for row in rows:
        workouts.append(WorkoutOut.of(row, *await workout_counts(db, row.id)))
    return WorkoutListOut(workouts=workouts)


@router.put(
    "/workouts/{workout_id}", responses={201: {"model": WorkoutOut}, **error_responses(404, 409)}
)
async def save_workout(
    workout_id: RecordId, body: WorkoutIn, user: CurrentUser, response: Response, db: SessionDep
) -> WorkoutOut:
    row = await db.get(Workout, workout_id, with_for_update=True)
    if row is not None and row.user_id != user.id:
        raise _missing()
    if row is None:
        row = Workout(
            id=workout_id, user_id=user.id, started_at=body.started_at, local_date=body.local_date
        )
        db.add(row)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            await db.rollback()
            row = await db.get(Workout, workout_id, with_for_update=True)
            if row is None:
                raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_ACTIVE) from None
            if row.user_id != user.id:
                raise _missing() from None
    row.started_at = body.started_at
    row.local_date = body.local_date
    if row.finished_at is not None and row.finished_at < row.started_at:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    await db.commit()
    return WorkoutOut.of(row, *await workout_counts(db, row.id))


# Копия журнала для работы без сети: столько дней назад от сегодняшнего (ADR 0020).
RECENT_DAYS = 14


@router.get("/workouts/recent")
async def recent_workouts(user: CurrentUser, db: SessionDep) -> WorkoutRecentOut:
    """Тренировки последних дней целиком и последние подходы по каждому упражнению."""
    since = datetime.now(ZoneInfo(user.timezone)).date() - timedelta(days=RECENT_DAYS - 1)
    rows = await db.scalars(
        select(Workout)
        .where(
            Workout.user_id == user.id,
            or_(Workout.local_date >= since, Workout.finished_at.is_(None)),
        )
        .order_by(Workout.started_at.desc(), Workout.id.desc())
    )
    workouts = [await _detail(db, row, user.id) for row in rows.all()]
    latest_items = (
        await db.execute(
            select(WorkoutExercise.id, WorkoutExercise.exercise_id, Workout.id, Workout.started_at)
            .join(Workout)
            .where(
                Workout.user_id == user.id,
                Workout.finished_at.is_not(None),
                exists().where(WorkoutSet.workout_exercise_id == WorkoutExercise.id),
            )
            .ext(distinct_on(WorkoutExercise.exercise_id))
            .order_by(WorkoutExercise.exercise_id, Workout.started_at.desc(), Workout.id.desc())
        )
    ).all()
    latest = [
        ExerciseLatestOut(
            exercise_id=exercise_id,
            workout_id=workout_id,
            started_at=started_at,
            sets=[WorkoutSetOut.of(value) for value in await _sets(db, item_id)],
        )
        for item_id, exercise_id, workout_id, started_at in latest_items
    ]
    return WorkoutRecentOut(workouts=workouts, latest=latest)


async def _sets(db: AsyncSession, item_id: UUID) -> list[WorkoutSet]:
    return list(
        (
            await db.scalars(
                select(WorkoutSet)
                .where(WorkoutSet.workout_exercise_id == item_id)
                .order_by(WorkoutSet.created_at, WorkoutSet.id)
            )
        ).all()
    )


@router.get("/workouts/{workout_id}", responses=error_responses(404))
async def get_workout(workout_id: RecordId, user: CurrentUser, db: SessionDep) -> WorkoutDetailOut:
    return await _detail(db, await _workout(db, workout_id, user.id), user.id)


async def _detail(db: AsyncSession, row: Workout, user_id: UUID) -> WorkoutDetailOut:
    """Тренировка с упражнениями, подходами и тем, что было в прошлый раз."""
    items = (
        await db.scalars(
            select(WorkoutExercise)
            .where(WorkoutExercise.workout_id == row.id)
            .order_by(WorkoutExercise.position, WorkoutExercise.created_at)
        )
    ).all()
    output: list[WorkoutExerciseOut] = []
    for item in items:
        exercise = await db.get(Exercise, item.exercise_id)
        if exercise is None:
            raise _missing()
        sets = await _sets(db, item.id)
        previous_id = await db.scalar(
            select(WorkoutExercise.id)
            .join(Workout)
            .join(WorkoutSet, WorkoutSet.workout_exercise_id == WorkoutExercise.id)
            .where(
                Workout.user_id == user_id,
                Workout.id != row.id,
                Workout.started_at < row.started_at,
                Workout.finished_at.is_not(None),
                WorkoutExercise.exercise_id == item.exercise_id,
            )
            .order_by(Workout.started_at.desc())
            .limit(1)
        )
        previous = await _sets(db, previous_id) if previous_id is not None else []
        output.append(
            WorkoutExerciseOut(
                id=item.id,
                exercise=ExerciseOut.of(exercise),
                position=item.position,
                sets=[WorkoutSetOut.of(value) for value in sets],
                previous=[WorkoutSetOut.of(value) for value in previous],
            )
        )
    return WorkoutDetailOut(
        **WorkoutOut.of(row, len(items), sum(len(item.sets) for item in output)).model_dump(),
        exercises=output,
    )


@router.post("/workouts/{workout_id}/finish", responses=error_responses(404, 409))
async def finish_workout(
    workout_id: RecordId, body: WorkoutFinishIn, user: CurrentUser, db: SessionDep
) -> WorkoutOut:
    row = await _workout(db, workout_id, user.id)
    if body.finished_at < row.started_at or body.finished_at > datetime.now(UTC) + timedelta(
        days=1
    ):
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    if row.finished_at is None:
        row.finished_at = body.finished_at
        await db.commit()
    return WorkoutOut.of(row, *await workout_counts(db, row.id))


@router.post(
    "/workouts/{workout_id}/repeat",
    responses={201: {"model": WorkoutOut}, **error_responses(404, 409, 422)},
)
async def repeat_workout(
    workout_id: RecordId,
    body: WorkoutRepeatIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> WorkoutOut:
    source = await _workout(db, workout_id, user.id)
    if source.finished_at is None:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    existing = await db.get(Workout, body.id)
    if existing is not None:
        if existing.user_id != user.id:
            raise _missing()
        if existing.repeated_from_id != source.id:
            raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.INVALID_WORKOUT_REPEAT)
        return WorkoutOut.of(existing, *await workout_counts(db, existing.id))
    source_items = (
        await db.scalars(
            select(WorkoutExercise)
            .join(Exercise)
            .where(WorkoutExercise.workout_id == source.id, Exercise.archived_at.is_(None))
            .order_by(WorkoutExercise.position)
        )
    ).all()
    if len(source_items) != len(body.item_ids):
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.INVALID_WORKOUT_REPEAT)
    if body.exercise_ids is not None and body.exercise_ids != [
        item.exercise_id for item in source_items
    ]:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_SOURCE_CHANGED)
    target = Workout(
        id=body.id,
        user_id=user.id,
        started_at=body.started_at,
        local_date=body.local_date,
        repeated_from_id=source.id,
    )
    db.add(target)
    try:
        await db.flush()
        db.add_all(
            WorkoutExercise(
                id=new_id,
                workout_id=target.id,
                exercise_id=item.exercise_id,
                position=position,
            )
            for position, (new_id, item) in enumerate(zip(body.item_ids, source_items, strict=True))
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.get(Workout, body.id)
        if existing is not None:
            if existing.user_id != user.id:
                raise _missing() from None
            if existing.repeated_from_id != source.id:
                raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.INVALID_WORKOUT_REPEAT) from None
            return WorkoutOut.of(existing, *await workout_counts(db, existing.id))
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_ACTIVE) from None
    response.status_code = status.HTTP_201_CREATED
    return WorkoutOut.of(target, len(source_items), 0)


@router.delete("/workouts/{workout_id}", status_code=204, responses=error_responses(404))
async def delete_workout(workout_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    row = await _workout(db, workout_id, user.id)
    await db.delete(row)
    await db.commit()


@router.put(
    "/workouts/{workout_id}/exercises/{item_id}",
    responses={201: {"model": WorkoutExerciseOut}, **error_responses(404, 409)},
)
async def save_workout_exercise(
    workout_id: RecordId,
    item_id: RecordId,
    body: WorkoutExerciseIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> WorkoutExerciseOut:
    row = await _workout(db, workout_id, user.id)
    if row.finished_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    exercise = await db.scalar(
        select(Exercise).where(Exercise.id == body.exercise_id, Exercise.user_id == user.id)
    )
    if exercise is None or exercise.archived_at is not None:
        raise _missing()
    item = await db.get(WorkoutExercise, item_id, with_for_update=True)
    if item is not None:
        if item.workout_id != row.id:
            raise _missing()
        if item.exercise_id != exercise.id:
            raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.INVALID_WORKOUT_SET)
    else:
        last = await db.scalar(
            select(func.max(WorkoutExercise.position)).where(WorkoutExercise.workout_id == row.id)
        )
        item = WorkoutExercise(
            id=item_id, workout_id=row.id, exercise_id=exercise.id, position=(last or 0) + 1
        )
        db.add(item)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            await db.rollback()
            raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.INVALID_WORKOUT_SET) from None
    await db.commit()
    return WorkoutExerciseOut(
        id=item.id, exercise=ExerciseOut.of(exercise), position=item.position, sets=[], previous=[]
    )


@router.delete(
    "/workouts/{workout_id}/exercises/{item_id}",
    status_code=204,
    responses=error_responses(404, 409),
)
async def delete_workout_exercise(
    workout_id: RecordId, item_id: RecordId, user: CurrentUser, db: SessionDep
) -> None:
    row = await _workout(db, workout_id, user.id)
    if row.finished_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    item = await _item(db, row.id, item_id)
    await db.delete(item)
    await db.commit()


def _values(body: WorkoutSetIn, exercise: Exercise) -> dict[str, object]:
    kind = exercise.kind
    if kind == ExerciseKind.WEIGHT_REPS:
        valid = body.reps is not None and body.weight_value is not None
        valid &= all(
            value is None
            for value in (
                body.duration_seconds,
                body.distance_value,
                body.incline_percent,
                body.level,
            )
        )
    elif kind == ExerciseKind.REPS:
        valid = body.reps is not None and all(
            value is None
            for value in (
                body.weight_value,
                body.duration_seconds,
                body.distance_value,
                body.incline_percent,
                body.level,
            )
        )
    elif kind == ExerciseKind.TIME:
        valid = body.duration_seconds is not None and all(
            value is None
            for value in (
                body.reps,
                body.weight_value,
                body.distance_value,
                body.incline_percent,
                body.level,
            )
        )
    else:
        valid = (
            body.duration_seconds is not None and body.reps is None and body.weight_value is None
        )
        valid &= body.distance_value is None or CardioField.DISTANCE in exercise.cardio_fields
        valid &= body.incline_percent is None or CardioField.INCLINE in exercise.cardio_fields
        valid &= body.level is None or CardioField.LEVEL in exercise.cardio_fields
    if not valid:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.INVALID_WORKOUT_SET)
    return {
        "kind": kind,
        "reps": body.reps,
        "weight_kg": (body.weight_value * (_KG_PER_LB if body.weight_unit == "lb" else 1)).quantize(
            Decimal("0.001")
        )
        if body.weight_value is not None
        else None,
        "weight_value": body.weight_value,
        "weight_unit": body.weight_unit,
        "duration_seconds": body.duration_seconds,
        "distance_km": (
            body.distance_value * (_KM_PER_MI if body.distance_unit == "mi" else 1)
        ).quantize(Decimal("0.001"))
        if body.distance_value is not None
        else None,
        "distance_value": body.distance_value,
        "distance_unit": body.distance_unit,
        "incline_percent": body.incline_percent,
        "level": body.level,
    }


@router.put(
    "/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}",
    responses={201: {"model": WorkoutSetOut}, **error_responses(404, 409, 422)},
)
async def save_workout_set(
    workout_id: RecordId,
    item_id: RecordId,
    set_id: RecordId,
    body: WorkoutSetIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> WorkoutSetOut:
    row = await _workout(db, workout_id, user.id)
    if row.finished_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    item = await _item(db, row.id, item_id)
    exercise = await db.get(Exercise, item.exercise_id)
    if exercise is None:
        raise _missing()
    entry = await db.get(WorkoutSet, set_id, with_for_update=True)
    if entry is not None and entry.workout_exercise_id != item.id:
        raise _missing()
    if entry is None and exercise.archived_at is not None:
        raise _missing()
    values = _values(body, exercise)
    if entry is None:
        entry = WorkoutSet(id=set_id, workout_exercise_id=item.id, **values)
        db.add(entry)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            await db.rollback()
            raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.INVALID_WORKOUT_SET) from None
    else:
        for key, value in values.items():
            setattr(entry, key, value)
    await db.commit()
    return WorkoutSetOut.of(entry)


@router.delete(
    "/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}",
    status_code=204,
    responses=error_responses(404, 409),
)
async def delete_workout_set(
    workout_id: RecordId,
    item_id: RecordId,
    set_id: RecordId,
    user: CurrentUser,
    db: SessionDep,
) -> None:
    row = await _workout(db, workout_id, user.id)
    if row.finished_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_FINISHED)
    await _item(db, row.id, item_id)
    entry = await db.scalar(
        select(WorkoutSet).where(WorkoutSet.id == set_id, WorkoutSet.workout_exercise_id == item_id)
    )
    if entry is None:
        raise _missing()
    await db.delete(entry)
    await db.commit()
