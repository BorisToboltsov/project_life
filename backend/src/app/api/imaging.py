"""Owner-scoped ZIP upload and explicit selection of inspected studies."""

import math
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid7

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import exists, func, or_, select

from app.api.deps import CurrentUser
from app.api.studies import own as own_study
from app.config import get_settings
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.file_schemas import AttachmentIn, UploadedPart, UploadPlan
from app.files import file_mutation
from app.imaging.archive import DEFAULT_LIMITS
from app.imaging.dicom import Manifest
from app.models import Attachment, HealthStudy, ImagingImport, StudyImaging, User
from app.schemas import RecordId
from app.services.file_storage import PART_SIZE, file_storage

router = APIRouter(tags=["imaging"], responses=error_responses(404, 409, 422, 503))


class ImportIn(AttachmentIn):
    size: int = Field(gt=0, le=DEFAULT_LIMITS.archive)


class Candidate(BaseModel):
    uid: str
    description: str
    patients: list[str]
    modalities: list[str]
    series: int
    frames: int
    warnings: list[str]


class ImportOut(BaseModel):
    id: UUID
    name: str
    size: int
    sha256: str
    state: str
    failure: str | None
    candidates: list[Candidate]
    skipped: int
    selection: dict[str, str] | None


class Confirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    studies: dict[str, RecordId] = Field(min_length=1, max_length=100)


def output(row: ImagingImport) -> ImportOut:
    manifest = Manifest.model_validate(row.manifest) if row.manifest else None
    return ImportOut(
        id=row.id,
        name=row.name,
        size=row.size,
        sha256=row.sha256,
        state=row.state,
        failure=row.failure,
        selection=row.selection,
        skipped=len(manifest.issues) if manifest else 0,
        candidates=[
            Candidate(
                uid=study.uid,
                description=study.description,
                patients=study.patients,
                modalities=study.modalities,
                series=len({stack.series_uid for stack in study.stacks}),
                frames=sum(len(stack.frames) for stack in study.stacks),
                warnings=study.warnings,
            )
            for study in manifest.studies
        ]
        if manifest
        else [],
    )


def visible(user_id: UUID):
    return (
        ImagingImport.user_id == user_id,
        ImagingImport.state != "deleted",
        or_(
            ImagingImport.anchor_id.is_not(None),
            exists().where(
                StudyImaging.import_id == ImagingImport.id,
                StudyImaging.user_id == user_id,
            ),
        ),
    )


async def own(
    db: SessionDep, import_id: UUID, user_id: UUID, *, lock: bool = False
) -> ImagingImport:
    query = select(ImagingImport).where(ImagingImport.id == import_id, *visible(user_id))
    if lock:
        await file_mutation(db)
        await db.scalar(select(User.id).where(User.id == user_id).with_for_update())
        query = query.with_for_update()
    row = await db.scalar(query)
    if row is None:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    return row


def active(row: ImagingImport) -> str:
    if row.state != "uploading" or row.expires_at <= datetime.now(UTC) or row.upload_id is None:
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)
    return row.upload_id


@router.get("/studies/{study_id}/imports")
async def list_imports(study_id: RecordId, user: CurrentUser, db: SessionDep) -> list[ImportOut]:
    await own_study(db, study_id, user.id)
    rows = await db.scalars(
        select(ImagingImport)
        .where(
            *visible(user.id),
            or_(
                ImagingImport.anchor_id == study_id,
                exists().where(
                    StudyImaging.import_id == ImagingImport.id,
                    StudyImaging.study_id == study_id,
                ),
            ),
        )
        .order_by(ImagingImport.created_at)
    )
    return [output(row) for row in rows]


@router.put("/studies/{study_id}/imports/{import_id}", responses={201: {"model": ImportOut}})
async def begin_import(
    study_id: RecordId,
    import_id: RecordId,
    body: ImportIn,
    user: CurrentUser,
    db: SessionDep,
    response: Response,
) -> ImportOut:
    await file_mutation(db)
    await db.scalar(select(User.id).where(User.id == user.id).with_for_update())
    await own_study(db, study_id, user.id)
    row = await db.get(ImagingImport, import_id, with_for_update=True)
    if row is not None:
        if row.user_id != user.id or row.anchor_id != study_id or row.state == "deleted":
            raise ApiError(404, ErrorCode.NOT_FOUND)
        if (row.name, row.size, row.sha256) != (body.name, body.size, body.sha256):
            raise ApiError(409, ErrorCode.FILE_CHANGED)
        return output(row)
    if await db.scalar(select(StudyImaging.study_id).where(StudyImaging.study_id == study_id)):
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)
    reserved = body.size + DEFAULT_LIMITS.expanded
    used = await db.scalar(
        select(func.coalesce(func.sum(Attachment.size), 0)).where(Attachment.user_id == user.id)
    )
    imaging_used = await db.scalar(
        select(func.coalesce(func.sum(ImagingImport.reserved_bytes), 0)).where(
            ImagingImport.user_id == user.id
        )
    )
    if (used or 0) + (imaging_used or 0) + reserved > get_settings().storage_quota_bytes:
        raise ApiError(409, ErrorCode.FILE_QUOTA)
    key = str(uuid7())
    try:
        upload = await run_in_threadpool(file_storage().start, key)
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    row = ImagingImport(
        id=import_id,
        user_id=user.id,
        anchor_id=study_id,
        name=body.name,
        size=body.size,
        sha256=body.sha256,
        object_key=key,
        upload_id=upload,
        state="uploading",
        reserved_bytes=reserved,
        expires_at=datetime.now(UTC) + timedelta(hours=24),
    )
    db.add(row)
    await db.commit()
    response.status_code = 201
    return output(row)


@router.get("/imaging-imports/{import_id}")
async def get_import(import_id: RecordId, user: CurrentUser, db: SessionDep) -> ImportOut:
    return output(await own(db, import_id, user.id))


@router.post("/imaging-imports/{import_id}/parts")
async def parts(import_id: RecordId, user: CurrentUser, db: SessionDep) -> UploadPlan:
    row = await own(db, import_id, user.id)
    upload = active(row)
    storage = file_storage()
    try:
        uploaded = await run_in_threadpool(storage.parts, row.object_key, upload)
        urls = [
            storage.part_url(
                row.object_key, upload, number, min(PART_SIZE, row.size - (number - 1) * PART_SIZE)
            )
            for number in range(1, math.ceil(row.size / PART_SIZE) + 1)
        ]
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    return UploadPlan(
        part_size=PART_SIZE,
        urls=urls,
        uploaded=[UploadedPart(number=n, size=s) for n, _, s in uploaded],
    )


@router.post("/imaging-imports/{import_id}/complete")
async def complete(import_id: RecordId, user: CurrentUser, db: SessionDep) -> ImportOut:
    row = await own(db, import_id, user.id, lock=True)
    if row.state in {"inspecting", "awaiting_confirmation", "importing", "ready"}:
        return output(row)
    upload = active(row)
    storage = file_storage()
    try:
        try:
            uploaded = await run_in_threadpool(storage.parts, row.object_key, upload)
            if len(uploaded) != math.ceil(row.size / PART_SIZE) or any(
                n != i or size != min(PART_SIZE, row.size - (i - 1) * PART_SIZE)
                for i, (n, _, size) in enumerate(uploaded, 1)
            ):
                raise ApiError(409, ErrorCode.FILE_INCOMPLETE)
            await run_in_threadpool(storage.finish, row.object_key, upload, uploaded)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") != "NoSuchUpload":
                raise
        await run_in_threadpool(storage.publish_copy, row.object_key, row.object_key)
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    row.state = "inspecting"
    await db.commit()
    return output(row)


@router.post("/imaging-imports/{import_id}/confirm")
async def confirm(
    import_id: RecordId, body: Confirmation, user: CurrentUser, db: SessionDep
) -> ImportOut:
    row = await own(db, import_id, user.id, lock=True)
    selection = {uid: str(target) for uid, target in body.studies.items()}
    if row.state in {"importing", "ready"} and row.selection == selection:
        return output(row)
    if row.state != "awaiting_confirmation" or not row.verified or row.manifest is None:
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)
    manifest = Manifest.model_validate(row.manifest)
    candidates = {study.uid: study for study in manifest.studies}
    if not set(selection) <= candidates.keys() or len(set(selection.values())) != len(selection):
        raise ApiError(422, ErrorCode.FILE_INVALID)
    if row.anchor_id is None or str(row.anchor_id) not in selection.values():
        raise ApiError(422, ErrorCode.FILE_INVALID)
    anchor = await own_study(db, row.anchor_id, user.id)
    for uid, target in body.studies.items():
        if await db.get(StudyImaging, target) is not None:
            raise ApiError(409, ErrorCode.FILE_CHANGED)
        if target != anchor.id:
            if await db.get(HealthStudy, target) is not None:
                raise ApiError(409, ErrorCode.FILE_CHANGED)
            db.add(
                HealthStudy(
                    id=target,
                    user_id=user.id,
                    title=candidates[uid].description[:120] or anchor.title,
                    local_date=anchor.local_date,
                    institution=anchor.institution,
                )
            )
    await db.flush()
    for uid, target in body.studies.items():
        db.add(StudyImaging(study_id=target, user_id=user.id, import_id=row.id, dicom_uid=uid))
    row.selection, row.state = selection, "importing"
    await db.commit()
    return output(row)


@router.delete("/imaging-imports/{import_id}", status_code=204)
async def remove(import_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    row = await own(db, import_id, user.id, lock=True)
    # Imported archives belong to all linked cards; delete those cards individually.
    if row.state in {"importing", "ready"}:
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)
    row.state = "deleted"
    await db.commit()
