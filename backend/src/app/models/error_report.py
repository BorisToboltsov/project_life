from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid7

from sqlalchemy import String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.columns import choice, one_of


class ErrorSource(StrEnum):
    BACKEND = "backend"
    FRONTEND = "frontend"


class ErrorReport(Base):
    """Сбой приложения: одна строка на место в коде, повторы только считаются.

    Колонки — весь состав отчёта (инвариант I9): текста исключения, сведений о запросе и
    о пользователе здесь нет.
    """

    __tablename__ = "error_reports"
    __table_args__ = (one_of("source", ErrorSource),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    # SHA-256 от источника, типа, места и стека: по нему повторы сводятся в одну строку.
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    source: Mapped[ErrorSource] = mapped_column(choice(ErrorSource))
    kind: Mapped[str] = mapped_column(String(120))
    # Шаблон маршрута, а не адрес: `PUT /api/measurements/{measurement_id}`.
    place: Mapped[str | None] = mapped_column(String(160))
    stack: Mapped[str] = mapped_column(Text)
    # Версия приложения при последнем повторе.
    version: Mapped[str] = mapped_column(String(32))
    count: Mapped[int] = mapped_column(default=1)
    first_seen: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(server_default=func.now())
