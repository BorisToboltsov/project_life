"""Группы тренировок: расписание и атомарный запуск со снимком состава."""

from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.api.workouts import workout_counts
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import Exercise, Workout, WorkoutExercise, WorkoutGroup, WorkoutGroupExercise
from app.schemas import (
    RecordId,
    WorkoutGroupIn,
    WorkoutGroupListOut,
    WorkoutGroupOut,
    WorkoutOut,
    WorkoutRepeatIn,
)

router = APIRouter(tags=["workout-groups"])


def _missing() -> ApiError:
    return ApiError(404, ErrorCode.NOT_FOUND)


def _invalid() -> ApiError:
    return ApiError(409, ErrorCode.INVALID_WORKOUT_GROUP)


async def _owned(db: AsyncSession, group_id: UUID, user_id: UUID) -> WorkoutGroup:
    group = await db.scalar(
        select(WorkoutGroup)
        .where(WorkoutGroup.id == group_id, WorkoutGroup.user_id == user_id)
        .with_for_update()
    )
    if group is None:
        raise _missing()
    return group


async def _ids(db: AsyncSession, group_id: UUID) -> list[UUID]:
    return list(
        await db.scalars(
            select(WorkoutGroupExercise.exercise_id)
            .where(WorkoutGroupExercise.group_id == group_id)
            .order_by(WorkoutGroupExercise.position)
        )
    )


async def _out(db: AsyncSession, group: WorkoutGroup, day: date) -> WorkoutGroupOut:
    return WorkoutGroupOut(
        id=group.id,
        name=group.name,
        exercise_ids=await _ids(db, group.id),
        weekdays=group.weekdays,
        start_date=group.start_date,
        end_date=group.end_date,
        dates=group.dates,
        scheduled=group.scheduled_on(day),
    )


@router.get("/workout-groups")
async def list_groups(
    user: CurrentUser, db: SessionDep, day: date | None = None
) -> WorkoutGroupListOut:
    day = day or datetime.now(ZoneInfo(user.timezone)).date()
    groups = await db.scalars(
        select(WorkoutGroup)
        .where(WorkoutGroup.user_id == user.id, WorkoutGroup.archived_at.is_(None))
        .order_by(WorkoutGroup.created_at, WorkoutGroup.id)
    )
    return WorkoutGroupListOut(date=day, groups=[await _out(db, group, day) for group in groups])


@router.put(
    "/workout-groups/{group_id}",
    responses={201: {"model": WorkoutGroupOut}, **error_responses(404, 409)},
)
async def save_group(
    group_id: RecordId, body: WorkoutGroupIn, user: CurrentUser, response: Response, db: SessionDep
) -> WorkoutGroupOut:
    group = await db.get(WorkoutGroup, group_id, with_for_update=True)
    if group is not None and (group.user_id != user.id or group.archived_at is not None):
        raise _missing()
    exercises = list(
        await db.scalars(
            select(Exercise.id).where(
                Exercise.id.in_(body.exercise_ids),
                Exercise.user_id == user.id,
                Exercise.archived_at.is_(None),
            )
        )
    )
    if len(exercises) != len(body.exercise_ids):
        raise _invalid()
    if group is None:
        group = WorkoutGroup(id=group_id, user_id=user.id)
        db.add(group)
        response.status_code = status.HTTP_201_CREATED
    for key in ("name", "weekdays", "start_date", "end_date", "dates"):
        setattr(group, key, getattr(body, key))
    try:
        await db.flush()
        await db.execute(
            delete(WorkoutGroupExercise).where(WorkoutGroupExercise.group_id == group_id)
        )
        db.add_all(
            WorkoutGroupExercise(group_id=group_id, exercise_id=exercise_id, position=index)
            for index, exercise_id in enumerate(body.exercise_ids)
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Одновременное первое сохранение того же клиентского ключа: повтор обновит ту же группу.
        existing = await db.get(WorkoutGroup, group_id)
        if existing is not None and existing.user_id != user.id:
            raise _missing() from None
        raise _invalid() from None
    return await _out(db, group, datetime.now(ZoneInfo(user.timezone)).date())


@router.delete("/workout-groups/{group_id}", status_code=204, responses=error_responses(404))
async def delete_group(group_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    group = await _owned(db, group_id, user.id)
    group.archived_at = group.archived_at or datetime.now(UTC)
    await db.commit()


@router.post(
    "/workout-groups/{group_id}/start",
    responses={201: {"model": WorkoutOut}, **error_responses(404, 409)},
)
async def start_group(
    group_id: RecordId, body: WorkoutRepeatIn, user: CurrentUser, response: Response, db: SessionDep
) -> WorkoutOut:
    group = await _owned(db, group_id, user.id)
    existing = await db.get(Workout, body.id)
    if existing is not None:
        if existing.user_id != user.id:
            raise _missing()
        if existing.source_group_id != group.id:
            raise _invalid()

        return WorkoutOut.of(existing, *await workout_counts(db, existing.id))
    if group.archived_at is not None:
        raise _missing()
    exercise_ids = await _ids(db, group.id)
    available = list(
        await db.scalars(
            select(Exercise.id).where(
                Exercise.id.in_(exercise_ids),
                Exercise.user_id == user.id,
                Exercise.archived_at.is_(None),
            )
        )
    )
    if body.exercise_ids is not None and body.exercise_ids != exercise_ids:
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.WORKOUT_SOURCE_CHANGED)
    if (
        not exercise_ids
        or len(available) != len(exercise_ids)
        or len(body.item_ids) != len(exercise_ids)
    ):
        raise _invalid()
    workout = Workout(
        id=body.id,
        user_id=user.id,
        started_at=body.started_at,
        local_date=body.local_date,
        source_group_id=group.id,
    )
    db.add(workout)
    try:
        await db.flush()
        db.add_all(
            WorkoutExercise(
                id=item_id, workout_id=workout.id, exercise_id=exercise_id, position=index
            )
            for index, (item_id, exercise_id) in enumerate(
                zip(body.item_ids, exercise_ids, strict=True)
            )
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, ErrorCode.WORKOUT_ACTIVE) from None
    response.status_code = status.HTTP_201_CREATED
    return WorkoutOut.of(workout, len(exercise_ids), 0)
