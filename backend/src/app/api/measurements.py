from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID, uuid7

from fastapi import APIRouter, Query, Response, status
from fastapi.exceptions import RequestValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.metrics import CATALOG, MetricPreset
from app.models import Measurement, Metric
from app.schemas import (
    MeasurementIn,
    MeasurementOut,
    MetricIn,
    MetricListOut,
    MetricOut,
    MetricPresetIn,
    MetricSummary,
    RecordId,
)

router = APIRouter(tags=["measurements"])

_NEWEST_FIRST = (Measurement.local_date.desc(), Measurement.measured_at.desc())
_IN_LIST_ORDER = (Metric.position, Metric.created_at)


def _invalid(field: str, reason: str) -> RequestValidationError:
    """Отказ того же вида, что даёт проверка схемы: значение не подходит по смыслу."""
    return RequestValidationError(
        [{"type": "value_error", "loc": ("body", field), "msg": reason, "input": None}]
    )


# --- Виды замеров -----------------------------------------------------------------------


@router.get("/metrics")
async def list_metrics(user: CurrentUser, db: SessionDep) -> MetricListOut:
    rows = (
        await db.scalars(select(Metric).where(Metric.user_id == user.id).order_by(*_IN_LIST_ORDER))
    ).all()
    listed = {metric.preset for metric in rows if metric.archived_at is None}
    return MetricListOut(
        metrics=[MetricOut.of(metric) for metric in rows],
        available=[preset for preset in MetricPreset if preset not in listed],
    )


async def _next_position(db: AsyncSession, user_id: UUID) -> int:
    last = await db.scalar(select(func.max(Metric.position)).where(Metric.user_id == user_id))
    return 0 if last is None else last + 1


@router.post("/metrics/presets")
async def add_preset_metric(body: MetricPresetIn, user: CurrentUser, db: SessionDep) -> MetricOut:
    """Ставит штатный вид замера в список пользователя: заводит его или возвращает убранный.

    Штатный вид у пользователя один, поэтому повтор запроса ничего не дублирует. Новый вид
    встаёт в конец списка, возвращённый — на прежнее место.
    """
    statement = insert(Metric).values(
        id=uuid7(),
        user_id=user.id,
        preset=body.preset,
        quantity=CATALOG[body.preset].quantity,
        position=await _next_position(db, user.id),
    )
    statement = statement.on_conflict_do_update(
        index_elements=[Metric.user_id, Metric.preset],
        index_where=Metric.preset.is_not(None),
        set_={"archived_at": None, "updated_at": func.now()},
    )
    metric = (await db.scalars(statement.returning(Metric))).one()
    await db.commit()
    return MetricOut.of(metric)


async def _own_metric(db: AsyncSession, metric_id: UUID, user_id: UUID) -> Metric | None:
    """Вид замера пользователя; чужой неотличим от несуществующего (инвариант I5)."""
    metric = await db.get(Metric, metric_id, with_for_update=True)
    if metric is not None and metric.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return metric


@router.put(
    "/metrics/{metric_id}",
    responses={201: {"model": MetricOut}, **error_responses(404)},
)
async def save_metric(
    metric_id: RecordId,
    body: MetricIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> MetricOut:
    """Добавляет в список пользователя свой вид замера или даёт своему новое название:
    повтор запроса не плодит дубли (ADR 0002). Убранный вид этим же запросом возвращается
    в список. Новый вид встаёт в конец списка. Штатный вид этим запросом не меняется.
    """
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    metric = await _own_metric(db, metric_id, user_id)
    if metric is None:
        metric = Metric(
            id=metric_id,
            user_id=user_id,
            name=body.name,
            quantity=body.quantity,
            position=await _next_position(db, user_id),
        )
        db.add(metric)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего вида либо отказ, если вид чужой.
            await db.rollback()
            metric = await _own_metric(db, metric_id, user_id)
    if metric is None or metric.preset is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    if metric.quantity != body.quantity:
        # Внесённые значения лежат в единице прежней величины.
        raise _invalid("quantity", "quantity of a metric cannot be changed")
    metric.name = body.name
    metric.archived_at = None
    await db.commit()
    return MetricOut.of(metric)


@router.delete(
    "/metrics/{metric_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_metric(metric_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    """Убирает вид замера из списка. Внесённые по нему замеры остаются: вернув вид в
    список, пользователь получает и его историю."""
    metric = await _own_metric(db, metric_id, user.id)
    if metric is None or metric.archived_at is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    metric.archived_at = datetime.now(UTC)
    await db.commit()


# --- Замеры -----------------------------------------------------------------------------


@router.get("/measurements")
async def list_measurements(
    user: CurrentUser,
    db: SessionDep,
    metric_id: UUID,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> list[MeasurementOut]:
    """История показателя, новые записи первыми; период — по местной дате, включительно.

    По чужому виду замера ответ тот же, что по несуществующему, — пустой список.
    """
    query = select(Measurement).where(
        Measurement.user_id == user.id, Measurement.metric_id == metric_id
    )
    if date_from:
        query = query.where(Measurement.local_date >= date_from)
    if date_to:
        query = query.where(Measurement.local_date <= date_to)
    rows = await db.scalars(query.order_by(*_NEWEST_FIRST))
    return [MeasurementOut.model_validate(row) for row in rows]


@router.get("/measurements/summary")
async def summarize_measurements(user: CurrentUser, db: SessionDep) -> list[MetricSummary]:
    """Последний и предыдущий замер по каждому виду из списка пользователя, включая
    убранные: расчёты берут последний вес, даже когда его нет на экране."""
    metric_ids = await db.scalars(
        select(Metric.id).where(Metric.user_id == user.id).order_by(*_IN_LIST_ORDER)
    )
    recent: dict[UUID, list[Measurement]] = {metric_id: [] for metric_id in metric_ids}
    recency = (
        func.row_number()
        .over(partition_by=Measurement.metric_id, order_by=_NEWEST_FIRST)
        .label("recency")
    )
    ranked = select(Measurement.id, recency).where(Measurement.user_id == user.id).subquery()
    rows = await db.scalars(
        select(Measurement)
        .join(ranked, ranked.c.id == Measurement.id)
        .where(ranked.c.recency <= 2)
        .order_by(*_NEWEST_FIRST)
    )
    for row in rows:
        recent[row.metric_id].append(row)
    return [
        MetricSummary(
            metric_id=metric_id,
            latest=MeasurementOut.model_validate(items[0]) if items else None,
            previous=MeasurementOut.model_validate(items[1]) if len(items) > 1 else None,
        )
        for metric_id, items in recent.items()
    ]


async def _own_measurement(
    db: AsyncSession, measurement_id: UUID, user_id: UUID
) -> Measurement | None:
    """Запись пользователя; чужая неотличима от несуществующей (инвариант I5)."""
    measurement = await db.get(Measurement, measurement_id, with_for_update=True)
    if measurement is not None and measurement.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return measurement


async def _require_metric(db: AsyncSession, metric_id: UUID, user_id: UUID) -> Metric:
    """Замер вносится только по виду из своего списка."""
    metric = await db.get(Metric, metric_id)
    if metric is None or metric.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.METRIC_NOT_FOUND)
    return metric


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
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    measurement = await _own_measurement(db, measurement_id, user_id)
    metric = await _require_metric(db, body.metric_id, user_id)
    if not metric.accepts(body.value, body.unit):
        raise _invalid("value", "value or unit does not fit the metric")
    fields = {
        "metric_id": body.metric_id,
        "value": body.canonical_value,
        "original_value": body.value,
        "original_unit": body.unit,
        "measured_at": body.measured_at,
        "local_date": body.local_date,
    }
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
