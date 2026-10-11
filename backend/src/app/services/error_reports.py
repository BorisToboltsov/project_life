"""Сбор ошибок (ADR 0006): из чего состоит отчёт и как он сохраняется.

В отчёте только место в коде — тип исключения, шаблон маршрута, кадры стека и версия
(инвариант I9). Текст исключения сюда не попадает вовсе: в нём бывают значения из запроса
и из базы.
"""

import hashlib
import traceback
from dataclasses import dataclass
from pathlib import PurePath

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app import __version__
from app.db import session_factory
from app.models import ErrorReport, ErrorSource

# Столько разных ошибок хранится; дальше вытесняются те, что дольше всех не повторялись.
MAX_REPORTS = 200
# Столько кадров остаётся от стека — ближайшие к месту сбоя.
MAX_FRAMES = 30


@dataclass(frozen=True)
class Report:
    source: ErrorSource
    kind: str
    place: str | None
    frames: tuple[str, ...]
    version: str

    @property
    def stack(self) -> str:
        return "\n".join(self.frames)

    @property
    def fingerprint(self) -> str:
        parts = (self.source, self.kind, self.place or "", self.stack)
        return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def _frame_file(filename: str) -> str:
    """Путь файла от корня пакета: каталоги машины в отчёт не попадают."""
    parts = PurePath(filename).parts
    for root in ("site-packages", "src"):
        if root in parts:
            return "/".join(parts[len(parts) - parts[::-1].index(root) :])
    return parts[-1] if parts else ""


def from_exception(error: BaseException, place: str | None) -> Report:
    """Отчёт о необработанном исключении бэкенда; `place` — шаблон маршрута."""
    cls = type(error)
    kind = (
        cls.__qualname__ if cls.__module__ == "builtins" else f"{cls.__module__}.{cls.__qualname__}"
    )
    frames = [
        f"{_frame_file(frame.f_code.co_filename)}:{line} {frame.f_code.co_qualname}"
        for frame, line in traceback.walk_tb(error.__traceback__)
    ]
    return Report(ErrorSource.BACKEND, kind[:120], place, tuple(frames[-MAX_FRAMES:]), __version__)


async def record(report: Report) -> None:
    """Сохраняет отчёт; повтор той же ошибки увеличивает счётчик.

    Сессия своя: к моменту сбоя транзакция запроса уже откатилась.
    """
    statement = insert(ErrorReport).values(
        fingerprint=report.fingerprint,
        source=report.source,
        kind=report.kind,
        place=report.place,
        stack=report.stack,
        version=report.version,
    )
    statement = statement.on_conflict_do_update(
        index_elements=[ErrorReport.fingerprint],
        set_={
            "count": ErrorReport.count + 1,
            "last_seen": func.now(),
            "version": statement.excluded.version,
        },
    )
    overflow = (
        select(ErrorReport.id)
        .order_by(ErrorReport.last_seen.desc(), ErrorReport.id.desc())
        .offset(MAX_REPORTS)
    )
    async with session_factory() as session:
        await session.execute(statement)
        await session.execute(delete(ErrorReport).where(ErrorReport.id.in_(overflow)))
        await session.commit()
