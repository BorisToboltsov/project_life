"""Как отчёты об ошибках попадают в сбор (ADR 0006): с сервера — через обёртку вокруг
приложения, с устройства пользователя — через эндпоинт."""

import logging

from fastapi import APIRouter, status
from fastapi.routing import iter_route_contexts
from starlette.types import ASGIApp, Receive, Scope, Send

from app.models import ErrorSource
from app.schemas import ErrorReportIn
from app.services import error_reports
from app.services.error_reports import Report

logger = logging.getLogger(__name__)

router = APIRouter(tags=["service"])


@router.post("/errors", status_code=status.HTTP_204_NO_CONTENT)
async def report_error(body: ErrorReportIn) -> None:
    """Сбой приложения на устройстве пользователя. Кто его прислал, не записывается."""
    frames = tuple(
        f"{frame.file}:{frame.line}:{frame.column} {frame.function}".rstrip()
        for frame in body.frames
    )
    await error_reports.record(
        Report(ErrorSource.FRONTEND, body.kind, body.route, frames, body.version)
    )


def _place(scope: Scope) -> str | None:
    """Шаблон маршрута, а не адрес запроса: в адресе бывают идентификаторы записей."""
    route = scope.get("route")
    for context in iter_route_contexts(scope["app"].routes):
        if context.original_route is route and context.path:
            return f"{scope['method']} {context.path}"
    return None


class CaptureErrors:
    """Необработанное исключение запроса становится отчётом об ошибке.

    Исключение не гасится: дальше его, как и прежде, логирует сервер, а клиент получает 500.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await self.app(scope, receive, send)
        except Exception as error:
            if scope["type"] == "http":
                try:
                    await error_reports.record(error_reports.from_exception(error, _place(scope)))
                except Exception:
                    # Сбой самого сбора не должен подменить исходную ошибку.
                    logger.warning("не удалось сохранить отчёт об ошибке", exc_info=True)
            raise
