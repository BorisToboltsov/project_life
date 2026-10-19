"""Бланки анализов, их значения и свои показатели (ADR 0022)."""

import hashlib
from collections import defaultdict
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.labs import CATALOG
from app.models import LabAnalyte, LabReport, LabValue
from app.schemas import (
    LabAnalyteIn,
    LabAnalyteListOut,
    LabAnalyteOut,
    LabPresetOut,
    LabReportIn,
    LabReportOut,
    LabUnitOut,
    LabValueIn,
    LabValueOut,
    RecordId,
)

router = APIRouter(tags=["labs"])

_NEWEST_FIRST = (LabReport.local_date.desc(), LabReport.created_at.desc(), LabReport.id)
_AS_ENTERED = (LabValue.created_at, LabValue.id)


def _invalid(field: str, reason: str) -> RequestValidationError:
    """Отказ того же вида, что даёт проверка схемы: значение не подходит по смыслу."""
    return RequestValidationError(
        [{"type": "value_error", "loc": ("body", field), "msg": reason, "input": None}]
    )


# --- Свои показатели --------------------------------------------------------------------


_PRESETS = [
    LabPresetOut(
        code=item.code,
        group=item.group,
        unit=item.unit,
        units=[LabUnitOut(unit=unit, factor=float(factor)) for unit, factor in item.units.items()],
        min_value=float(item.min_value),
        max_value=float(item.max_value),
    )
    for item in CATALOG.values()
]


@router.get("/lab-analytes")
async def list_lab_analytes(user: CurrentUser, db: SessionDep) -> LabAnalyteListOut:
    """Свои показатели пользователя вместе с убранными и справочник штатных целиком."""
    rows = await db.scalars(
        select(LabAnalyte)
        .where(LabAnalyte.user_id == user.id)
        .order_by(LabAnalyte.created_at, LabAnalyte.id)
    )
    return LabAnalyteListOut(analytes=[LabAnalyteOut.of(row) for row in rows], catalog=_PRESETS)


async def _own_analyte(db: AsyncSession, analyte_id: UUID, user_id: UUID) -> LabAnalyte | None:
    """Свой показатель пользователя; чужой неотличим от несуществующего (инвариант I5)."""
    analyte = await db.get(LabAnalyte, analyte_id, with_for_update=True)
    if analyte is not None and analyte.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return analyte


@router.put(
    "/lab-analytes/{analyte_id}",
    responses={201: {"model": LabAnalyteOut}, **error_responses(404)},
)
async def save_lab_analyte(
    analyte_id: RecordId,
    body: LabAnalyteIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> LabAnalyteOut:
    """Заводит свой показатель или даёт ему новое название: повтор запроса не плодит дубли
    (ADR 0002). Убранный показатель этим же запросом возвращается в список. Единица не
    меняется (инвариант I22)."""
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    analyte = await _own_analyte(db, analyte_id, user_id)
    if analyte is None:
        analyte = LabAnalyte(id=analyte_id, user_id=user_id, name=body.name, unit=body.unit)
        db.add(analyte)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего показателя либо отказ, если он чужой.
            await db.rollback()
            analyte = await _own_analyte(db, analyte_id, user_id)
    if analyte is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    if analyte.unit != body.unit:
        # Значения своего показателя лежат в его единице и не пересчитываются.
        raise _invalid("unit", "unit of an analyte cannot be changed")
    analyte.name = body.name
    analyte.archived_at = None
    await db.commit()
    return LabAnalyteOut.of(analyte)


@router.delete(
    "/lab-analytes/{analyte_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_lab_analyte(analyte_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    """Убирает свой показатель из списка. Внесённые по нему значения остаются в бланках."""
    analyte = await _own_analyte(db, analyte_id, user.id)
    if analyte is None or analyte.archived_at is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    analyte.archived_at = datetime.now(UTC)
    await db.commit()


# --- Бланки -----------------------------------------------------------------------------


@router.get(
    "/lab-reports",
    response_model=list[LabReportOut],
    responses={304: {"description": "Бланки не изменились с прошлого ответа"}},
)
async def list_lab_reports(
    user: CurrentUser,
    db: SessionDep,
    if_none_match: Annotated[str | None, Header()] = None,
) -> list[LabReportOut] | Response:
    """Все бланки пользователя со значениями, новые первыми. Их немного, поэтому тот же
    ответ ложится в копию для работы без сети (ADR 0020): метка `ETag` меняется, когда
    бланк или значение внесли, исправили или удалили; с прежней меткой в `If-None-Match`
    ответ — 304 без тела."""
    reports = list(
        await db.scalars(
            select(LabReport).where(LabReport.user_id == user.id).order_by(*_NEWEST_FIRST)
        )
    )
    values = await db.scalars(
        select(LabValue)
        .join(LabReport, LabReport.id == LabValue.report_id)
        .where(LabReport.user_id == user.id)
        .order_by(*_AS_ENTERED)
    )
    by_report: dict[UUID, list[LabValue]] = defaultdict(list)
    digest = hashlib.sha256(str(user.id).encode())
    for value in values:
        by_report[value.report_id].append(value)
        digest.update(f"|v{value.id}:{value.updated_at.isoformat()}".encode())
    for report in reports:
        digest.update(f"|r{report.id}:{report.updated_at.isoformat()}".encode())
    etag = f'"{digest.hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return JSONResponse(
        [
            LabReportOut.of(report, by_report[report.id]).model_dump(mode="json")
            for report in reports
        ],
        headers=headers,
    )


async def _own_report(db: AsyncSession, report_id: UUID, user_id: UUID) -> LabReport | None:
    """Бланк пользователя; чужой неотличим от несуществующего (инвариант I5)."""
    report = await db.get(LabReport, report_id, with_for_update=True)
    if report is not None and report.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return report


async def _require_report(db: AsyncSession, report_id: UUID, user_id: UUID) -> LabReport:
    report = await _own_report(db, report_id, user_id)
    if report is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return report


async def _values_of(db: AsyncSession, report_id: UUID) -> list[LabValue]:
    return list(
        await db.scalars(
            select(LabValue).where(LabValue.report_id == report_id).order_by(*_AS_ENTERED)
        )
    )


@router.put(
    "/lab-reports/{report_id}",
    responses={201: {"model": LabReportOut}, **error_responses(404)},
)
async def save_lab_report(
    report_id: RecordId,
    body: LabReportIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> LabReportOut:
    """Заводит бланк или заменяет шапку своего: повтор запроса не плодит дубли (ADR 0002).
    Значения бланка этим запросом не меняются."""
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    fields = {"local_date": body.local_date, "lab": body.lab, "note": body.note}
    report = await _own_report(db, report_id, user_id)
    if report is None:
        report = LabReport(id=report_id, user_id=user_id, **fields)
        db.add(report)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего бланка либо отказ, если бланк чужой.
            await db.rollback()
            report = await _require_report(db, report_id, user_id)
    for name, value in fields.items():
        setattr(report, name, value)
    await db.commit()
    return LabReportOut.of(report, await _values_of(db, report.id))


@router.delete(
    "/lab-reports/{report_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_lab_report(report_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    """Удаляет бланк вместе с его значениями."""
    report = await _require_report(db, report_id, user.id)
    await db.delete(report)
    await db.commit()


# --- Значения ---------------------------------------------------------------------------


async def _value_in(db: AsyncSession, report: LabReport, value_id: UUID) -> LabValue | None:
    """Значение этого бланка; значение другого бланка неотличимо от несуществующего."""
    value = await db.get(LabValue, value_id, with_for_update=True)
    if value is not None and value.report_id != report.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return value


async def _analyte_taken(
    db: AsyncSession, report_id: UUID, value_id: UUID, body: LabValueIn
) -> bool:
    """В бланке уже есть другое значение того же показателя."""
    same = (
        LabValue.preset == body.preset
        if body.preset is not None
        else LabValue.analyte_id == body.analyte_id
    )
    found = await db.scalar(
        select(LabValue.id).where(LabValue.report_id == report_id, LabValue.id != value_id, same)
    )
    return found is not None


@router.put(
    "/lab-reports/{report_id}/values/{value_id}",
    responses={201: {"model": LabValueOut}, **error_responses(404, 409)},
)
async def save_lab_value(
    report_id: RecordId,
    value_id: RecordId,
    body: LabValueIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> LabValueOut:
    """Вносит значение показателя в бланк или заменяет своё же: повтор запроса не плодит
    дубли (ADR 0002). Показатель значения не меняется (инвариант I22); в бланке он
    встречается один раз."""
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    report = await _require_report(db, report_id, user_id)
    if body.analyte_id is not None:
        analyte = await db.get(LabAnalyte, body.analyte_id)
        if analyte is None or analyte.user_id != user_id:
            raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.LAB_ANALYTE_NOT_FOUND)
    if await _analyte_taken(db, report.id, value_id, body):
        raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.LAB_VALUE_TAKEN)
    fields = {
        "value": body.canonical_value,
        "original_value": body.value,
        "original_unit": body.unit,
        "ref_low": body.ref_low,
        "ref_high": body.ref_high,
    }
    value = await _value_in(db, report, value_id)
    if value is None:
        value = LabValue(
            id=value_id,
            report_id=report.id,
            preset=body.preset,
            analyte_id=body.analyte_id,
            **fields,
        )
        db.add(value)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Параллельный запрос успел первым: либо с тем же ключом — дальше это замена,
            # либо с тем же показателем в бланке — тогда отказ.
            await db.rollback()
            report = await _require_report(db, report_id, user_id)
            value = await _value_in(db, report, value_id)
            if value is None:
                raise ApiError(status.HTTP_409_CONFLICT, ErrorCode.LAB_VALUE_TAKEN) from None
    if value.preset != body.preset:
        raise _invalid("preset", "analyte of a value cannot be changed")
    if value.analyte_id != body.analyte_id:
        raise _invalid("analyte_id", "analyte of a value cannot be changed")
    for name, field in fields.items():
        setattr(value, name, field)
    await db.commit()
    return LabValueOut.model_validate(value)


@router.delete(
    "/lab-reports/{report_id}/values/{value_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_lab_value(
    report_id: RecordId, value_id: RecordId, user: CurrentUser, db: SessionDep
) -> None:
    report = await _require_report(db, report_id, user.id)
    value = await _value_in(db, report, value_id)
    if value is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(value)
    await db.commit()
