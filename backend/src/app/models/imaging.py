"""One original archive may back several user-owned study records."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ImagingImport(Base):
    __tablename__ = "imaging_imports"
    __table_args__ = (
        UniqueConstraint("id", "user_id"),
        ForeignKeyConstraint(
            ["anchor_id", "user_id"],
            ["health_studies.id", "health_studies.user_id"],
            ondelete="SET NULL (anchor_id)",
        ),
        CheckConstraint("size > 0 AND size <= 2147483648", name="size"),
        CheckConstraint("reserved_bytes >= size", name="reservation"),
        CheckConstraint(
            "state IN ('uploading','inspecting','awaiting_confirmation',"
            "'importing','ready','failed','deleted')",
            name="state",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    anchor_id: Mapped[UUID | None]
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    object_key: Mapped[str] = mapped_column(String(100), unique=True)
    upload_id: Mapped[str | None] = mapped_column(String(300))
    state: Mapped[str] = mapped_column(String(24))
    reserved_bytes: Mapped[int] = mapped_column(BigInteger)
    verified: Mapped[bool] = mapped_column(default=False, server_default="false")
    failure: Mapped[str | None] = mapped_column(String(40))
    manifest: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    selection: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]


class StudyImaging(Base):
    __tablename__ = "study_imaging"
    __table_args__ = (
        ForeignKeyConstraint(
            ["study_id", "user_id"],
            ["health_studies.id", "health_studies.user_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["import_id", "user_id"],
            ["imaging_imports.id", "imaging_imports.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("import_id", "dicom_uid"),
    )

    study_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID]
    import_id: Mapped[UUID] = mapped_column(index=True)
    dicom_uid: Mapped[str] = mapped_column(String(64))


class ImagingObject(Base):
    __tablename__ = "imaging_objects"
    __table_args__ = (UniqueConstraint("import_id", "member"),)

    object_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("imaging_imports.id", ondelete="CASCADE"), index=True
    )
    member: Mapped[int]
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
