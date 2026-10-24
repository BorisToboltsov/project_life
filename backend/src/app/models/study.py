"""User-owned imaging study records, independent of lab reports."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class HealthStudy(Base):
    __tablename__ = "health_studies"
    __table_args__ = (
        UniqueConstraint("id", "user_id"),
        Index("ix_health_studies_user_date", "user_id", "local_date"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    local_date: Mapped[date]
    institution: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
