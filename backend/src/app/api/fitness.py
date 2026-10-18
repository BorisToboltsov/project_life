import hashlib
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
from app.models import FitnessResult
from app.schemas import FitnessResultIn, FitnessResultOut, RecordId

router = APIRouter(tags=["fitness"])

_NEWEST_FIRST = (FitnessResult.local_date.desc(), FitnessResult.tested_at.desc(), FitnessResult.id)


def _invalid(field: str, reason: str) -> RequestValidationError:
    """Отказ того же вида, что даёт проверка схемы: значение не подходит по смыслу."""
    return RequestValidationError(
        [{"type": "value_error", "loc": ("body", field), "msg": reason, "input": None}]
    )


@router.get(
    "/fitness-results",
    response_model=list[FitnessResultOut],
    responses={304: {"description": "Результаты не изменились с прошлого ответа"}},
)
async def list_fitness_results(
    user: CurrentUser,
    db: SessionDep,
    if_none_match: Annotated[str | None, Header()] = None,
) -> list[FitnessResultOut] | Response:
    """Все результаты тестов пользователя, новые первыми. Их немного, поэтому тот же ответ
    ложится в копию для работы без сети (ADR 0020): метка `ETag` меняется, когда результат
    внесли, исправили или удалили; с прежней меткой в `If-None-Match` ответ — 304 без тела.
    """
    rows = list(
        await db.scalars(
            select(FitnessResult).where(FitnessResult.user_id == user.id).order_by(*_NEWEST_FIRST)
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
        [FitnessResultOut.model_validate(row).model_dump(mode="json") for row in rows],
        headers=headers,
    )


async def _own_result(db: AsyncSession, result_id: UUID, user_id: UUID) -> FitnessResult | None:
    """Результат пользователя; чужой неотличим от несуществующего (инвариант I5)."""
    result = await db.get(FitnessResult, result_id, with_for_update=True)
    if result is not None and result.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return result


@router.put(
    "/fitness-results/{result_id}",
    responses={201: {"model": FitnessResultOut}, **error_responses(404)},
)
async def save_fitness_result(
    result_id: RecordId,
    body: FitnessResultIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> FitnessResultOut:
    """Создаёт результат или заменяет свой же: повтор запроса не плодит дубли (ADR 0002).
    Тест и вариант отжиманий у результата не меняются (инвариант I21)."""
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    fields = {
        "tested_at": body.tested_at,
        "local_date": body.local_date,
        "reps": body.reps,
        "distance_m": body.distance_m,
        "distance_value": body.distance_value,
        "distance_unit": body.distance_unit,
    }
    result = await _own_result(db, result_id, user_id)
    if result is None:
        result = FitnessResult(
            id=result_id, user_id=user_id, test=body.test, variant=body.variant, **fields
        )
        db.add(result)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего результата либо отказ, если результат чужой.
            await db.rollback()
            result = await _own_result(db, result_id, user_id)
    if result is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    if result.test != body.test:
        raise _invalid("test", "test of a result cannot be changed")
    if result.variant != body.variant:
        # Оценку подбирают по варианту: отжимания с колен не становятся классическими.
        raise _invalid("variant", "push-up variant cannot be changed")
    for name, value in fields.items():
        setattr(result, name, value)
    await db.commit()
    return FitnessResultOut.model_validate(result)


@router.delete(
    "/fitness-results/{result_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_fitness_result(result_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    result = await _own_result(db, result_id, user.id)
    if result is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(result)
    await db.commit()
