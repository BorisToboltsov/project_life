from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.metrics import CATALOG, Metric
from app.models import Measurement
from app.schemas import MeasurementIn, MeasurementOut, MetricSummary, MetricTypeOut, RecordId

router = APIRouter(tags=["measurements"])

_NEWEST_FIRST = (Measurement.local_date.desc(), Measurement.measured_at.desc())


@router.get("/metric-types")
async def list_metric_types() -> list[MetricTypeOut]:
    return [MetricTypeOut.model_validate(metric_type) for metric_type in CATALOG.values()]


@router.get("/measurements")
async def list_measurements(
    user: CurrentUser,
    db: SessionDep,
    metric: Metric,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> list[MeasurementOut]:
    """История показателя, новые записи первыми; период — по местной дате, включительно."""
    query = select(Measurement).where(Measurement.user_id == user.id, Measurement.metric == metric)
    if date_from:
        query = query.where(Measurement.local_date >= date_from)
    if date_to:
        query = query.where(Measurement.local_date <= date_to)
    rows = await db.scalars(query.order_by(*_NEWEST_FIRST))
    return [MeasurementOut.model_validate(row) for row in rows]


@router.get("/measurements/summary")
async def summarize_measurements(user: CurrentUser, db: SessionDep) -> list[MetricSummary]:
    recency = (
        func.row_number()
        .over(partition_by=Measurement.metric, order_by=_NEWEST_FIRST)
        .label("recency")
    )
    ranked = select(Measurement.id, recency).where(Measurement.user_id == user.id).subquery()
    rows = await db.scalars(
        select(Measurement)
        .join(ranked, ranked.c.id == Measurement.id)
        .where(ranked.c.recency <= 2)
        .order_by(*_NEWEST_FIRST)
    )
    recent: dict[Metric, list[Measurement]] = {metric: [] for metric in CATALOG}
    for row in rows:
        recent[row.metric].append(row)
    return [
        MetricSummary(
            metric=metric,
            latest=MeasurementOut.model_validate(items[0]) if items else None,
            previous=MeasurementOut.model_validate(items[1]) if len(items) > 1 else None,
        )
        for metric, items in recent.items()
    ]


async def _own_measurement(
    db: AsyncSession, measurement_id: UUID, user_id: UUID
) -> Measurement | None:
    """Запись пользователя; чужая неотличима от несуществующей (инвариант I5)."""
    measurement = await db.get(Measurement, measurement_id, with_for_update=True)
    if measurement is not None and measurement.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return measurement


@router.put(
    "/measurements/{measurement_id}",
    responses={201: {"model": MeasurementOut}, **error_responses(404)},
)
async def save_measurement(
    measurement_id: RecordId,
    body: MeasurementIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> MeasurementOut:
    """Создаёт запись или заменяет свою же: повтор запроса не плодит дубли (ADR 0002)."""
    fields = {
        "metric": body.metric,
        "value": body.canonical_value,
        "original_value": body.value,
        "original_unit": body.unit,
        "measured_at": body.measured_at,
        "local_date": body.local_date,
    }
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    measurement = await _own_measurement(db, measurement_id, user_id)
    if measurement is None:
        measurement = Measurement(id=measurement_id, user_id=user_id, **fields)
        db.add(measurement)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своей записи либо отказ, если запись чужая.
            await db.rollback()
            measurement = await _own_measurement(db, measurement_id, user_id)
    if measurement is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    for name, value in fields.items():
        setattr(measurement, name, value)
    await db.commit()
    return MeasurementOut.model_validate(measurement)


@router.delete(
    "/measurements/{measurement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_measurement(measurement_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    measurement = await _own_measurement(db, measurement_id, user.id)
    if measurement is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(measurement)
    await db.commit()
