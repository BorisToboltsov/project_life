"""File metadata survives parent deletion until the storage cleanup has finished."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, ForeignKeyConstraint, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("report_id IS NULL OR study_id IS NULL", name="one_parent"),
        ForeignKeyConstraint(
            ["report_id", "user_id"],
            ["lab_reports.id", "lab_reports.user_id"],
            ondelete="SET NULL (report_id)",
        ),
        ForeignKeyConstraint(
            ["study_id", "user_id"],
            ["health_studies.id", "health_studies.user_id"],
            ondelete="SET NULL (study_id)",
        ),
        CheckConstraint("size > 0 AND size <= 52428800", name="size"),
        CheckConstraint(
            "state IN ('uploading', 'verifying', 'ready', 'failed', 'deleted')", name="state"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    report_id: Mapped[UUID | None] = mapped_column(index=True)
    study_id: Mapped[UUID | None] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16))
    content_type: Mapped[str | None] = mapped_column(String(40))
    upload_id: Mapped[str | None] = mapped_column(String(300))
    object_key: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
