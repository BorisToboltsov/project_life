"""Показания давления (ADR 0022)."""

import hashlib
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import BloodPressureReading
from app.schemas import BloodPressureIn, BloodPressureOut, RecordId

router = APIRouter(tags=["pressure"])

_NEWEST_FIRST = (
    BloodPressureReading.local_date.desc(),
    BloodPressureReading.measured_at.desc(),
    BloodPressureReading.id,
)


@router.get(
    "/blood-pressure",
    response_model=list[BloodPressureOut],
    responses={304: {"description": "Показания не изменились с прошлого ответа"}},
)
async def list_blood_pressure(
    user: CurrentUser,
    db: SessionDep,
    if_none_match: Annotated[str | None, Header()] = None,
) -> list[BloodPressureOut] | Response:
    """Все показания давления, новые первыми, — и для экрана, и для копии без сети
    (ADR 0020): метка `ETag` меняется, когда показание внесли, исправили или удалили; с
    прежней меткой в `If-None-Match` ответ — 304 без тела."""
    rows = list(
        await db.scalars(
            select(BloodPressureReading)
            .where(BloodPressureReading.user_id == user.id)
            .order_by(*_NEWEST_FIRST)
        )
    )
    digest = hashlib.sha256(str(user.id).encode())
    for row in rows:
        digest.update(f"|{row.id}:{row.updated_at.isoformat()}".encode())
    etag = f'"{digest.hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return JSONResponse(
        [BloodPressureOut.model_validate(row).model_dump(mode="json") for row in rows],
        headers=headers,
    )


async def _own_reading(
    db: AsyncSession, reading_id: UUID, user_id: UUID
) -> BloodPressureReading | None:
    """Показание пользователя; чужое неотличимо от несуществующего (инвариант I5)."""
    reading = await db.get(BloodPressureReading, reading_id, with_for_update=True)
    if reading is not None and reading.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return reading


@router.put(
    "/blood-pressure/{reading_id}",
    responses={201: {"model": BloodPressureOut}, **error_responses(404)},
)
async def save_blood_pressure(
    reading_id: RecordId,
    body: BloodPressureIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> BloodPressureOut:
    """Вносит показание или заменяет своё же: повтор запроса не плодит дубли (ADR 0002)."""
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    fields = {
        "measured_at": body.measured_at,
        "local_date": body.local_date,
        "systolic": body.systolic,
        "diastolic": body.diastolic,
        "pulse": body.pulse,
    }
    reading = await _own_reading(db, reading_id, user_id)
    if reading is None:
        reading = BloodPressureReading(id=reading_id, user_id=user_id, **fields)
        db.add(reading)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего показания либо отказ, если оно чужое.
            await db.rollback()
            reading = await _own_reading(db, reading_id, user_id)
    if reading is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    for name, value in fields.items():
        setattr(reading, name, value)
    await db.commit()
    return BloodPressureOut.model_validate(reading)


@router.delete(
    "/blood-pressure/{reading_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_blood_pressure(reading_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    reading = await _own_reading(db, reading_id, user.id)
    if reading is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(reading)
    await db.commit()
