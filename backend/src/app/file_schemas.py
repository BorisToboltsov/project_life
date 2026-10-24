"""Online file transfer contracts, separate from offline health records."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


class AttachmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    size: int = Field(gt=0, le=50 * 1024 * 1024)
    sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]

    @field_validator("name")
    @classmethod
    def safe_name(cls, value: str) -> str:
        if any(ord(c) < 32 or c in "/\\" for c in value):
            raise ValueError("unsafe filename")
        return value


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    size: int
    sha256: str
    state: Literal["uploading", "verifying", "ready", "failed", "deleted"]
    content_type: str | None
    created_at: datetime
    expires_at: datetime


class UploadedPart(BaseModel):
    number: int
    size: int


class UploadPlan(BaseModel):
    part_size: int
    urls: list[str]
    uploaded: list[UploadedPart]
