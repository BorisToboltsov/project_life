"""Study records inside Health. Uploads are separate online operations."""

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.files import file_mutation
from app.models import HealthStudy, User
from app.schemas import RecordId

router = APIRouter(tags=["studies"], responses=error_responses(404))


class StudyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    local_date: date
    institution: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = (
        None
    )
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None


class StudyOut(StudyIn):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    created_at: datetime
    updated_at: datetime


async def own(db: SessionDep, study_id: UUID, user_id: UUID) -> HealthStudy:
    row = await db.get(HealthStudy, study_id, with_for_update=True)
    if row is None or row.user_id != user_id:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    return row


@router.get("/studies")
async def list_studies(user: CurrentUser, db: SessionDep) -> list[StudyOut]:
    rows = await db.scalars(
        select(HealthStudy)
        .where(HealthStudy.user_id == user.id)
        .order_by(HealthStudy.local_date.desc(), HealthStudy.id)
    )
    return [StudyOut.model_validate(row) for row in rows]


@router.get("/studies/{study_id}")
async def get_study(study_id: RecordId, user: CurrentUser, db: SessionDep) -> StudyOut:
    return StudyOut.model_validate(await own(db, study_id, user.id))


@router.put("/studies/{study_id}", responses={201: {"model": StudyOut}})
async def save_study(
    study_id: RecordId, body: StudyIn, user: CurrentUser, db: SessionDep, response: Response
) -> StudyOut:
    await db.scalar(select(User.id).where(User.id == user.id).with_for_update())
    row = await db.get(HealthStudy, study_id, with_for_update=True)
    if row is None:
        row = HealthStudy(id=study_id, user_id=user.id, **body.model_dump())
        db.add(row)
        response.status_code = 201
    elif row.user_id != user.id:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    else:
        for key, value in body.model_dump().items():
            setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return StudyOut.model_validate(row)


@router.delete("/studies/{study_id}", status_code=204)
async def delete_study(study_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    await file_mutation(db)
    await db.scalar(select(User.id).where(User.id == user.id).with_for_update())
    row = await own(db, study_id, user.id)
    await db.delete(row)
    await db.commit()
