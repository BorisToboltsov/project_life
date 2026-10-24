"""Owner-scoped lab attachments. File transfer is online-only."""

import math
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import quote
from uuid import UUID, uuid7

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Header, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from PIL import Image
from pypdf.errors import PyPdfError
from sqlalchemy import func, or_, select

from app.api.deps import CurrentUser
from app.config import get_settings
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.file_schemas import AttachmentIn, AttachmentOut, UploadedPart, UploadPlan
from app.files import content_range, exact_chunks, file_mutation, validated_content
from app.models import Attachment, HealthStudy, ImagingImport, LabReport, User
from app.schemas import RecordId
from app.services.file_storage import PART_SIZE, file_storage

router = APIRouter(tags=["attachments"], responses=error_responses(404, 409, 422, 503))


def missing() -> ApiError:
    return ApiError(404, ErrorCode.NOT_FOUND)


async def parent(db: SessionDep, report_id: UUID, user_id: UUID) -> LabReport:
    report = await db.get(LabReport, report_id, with_for_update=True)
    if report is None or report.user_id != user_id:
        raise missing()
    return report


async def own(db: SessionDep, file_id: UUID, user_id: UUID) -> Attachment:
    item = await db.scalar(
        select(Attachment)
        .outerjoin(LabReport, Attachment.report_id == LabReport.id)
        .outerjoin(HealthStudy, Attachment.study_id == HealthStudy.id)
        .where(
            Attachment.id == file_id,
            Attachment.user_id == user_id,
            or_(LabReport.user_id == user_id, HealthStudy.user_id == user_id),
            Attachment.state != "deleted",
        )
        .with_for_update(of=Attachment)
    )
    if item is None:
        raise missing()
    return item


def active(item: Attachment) -> None:
    if item.state != "uploading" or item.expires_at <= datetime.now(UTC):
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)


@router.get("/lab-reports/{report_id}/files")
async def list_files(report_id: RecordId, user: CurrentUser, db: SessionDep) -> list[AttachmentOut]:
    await parent(db, report_id, user.id)
    rows = await db.scalars(
        select(Attachment)
        .where(
            Attachment.report_id == report_id,
            Attachment.user_id == user.id,
            Attachment.state != "deleted",
        )
        .order_by(Attachment.created_at, Attachment.id)
    )
    return [AttachmentOut.model_validate(row) for row in rows]


@router.put("/lab-reports/{report_id}/files/{file_id}", responses={201: {"model": AttachmentOut}})
async def begin_file(
    report_id: RecordId,
    file_id: RecordId,
    body: AttachmentIn,
    user: CurrentUser,
    db: SessionDep,
    response: Response,
) -> AttachmentOut:
    return await create_file(report_id, None, file_id, body, user.id, db, response)


@router.get("/studies/{study_id}/files")
async def list_study_files(
    study_id: RecordId, user: CurrentUser, db: SessionDep
) -> list[AttachmentOut]:
    from app.api.studies import own as own_study

    await own_study(db, study_id, user.id)
    rows = await db.scalars(
        select(Attachment)
        .where(
            Attachment.study_id == study_id,
            Attachment.user_id == user.id,
            Attachment.state != "deleted",
        )
        .order_by(Attachment.created_at, Attachment.id)
    )
    return [AttachmentOut.model_validate(row) for row in rows]


@router.put("/studies/{study_id}/files/{file_id}", responses={201: {"model": AttachmentOut}})
async def begin_study_file(
    study_id: RecordId,
    file_id: RecordId,
    body: AttachmentIn,
    user: CurrentUser,
    db: SessionDep,
    response: Response,
) -> AttachmentOut:
    return await create_file(None, study_id, file_id, body, user.id, db, response)


async def create_file(
    report_id: UUID | None,
    study_id: UUID | None,
    file_id: UUID,
    body: AttachmentIn,
    user_id: UUID,
    db: SessionDep,
    response: Response,
) -> AttachmentOut:
    await file_mutation(db)
    # Serialize quota reservations and client-key retries, including other reports.
    await db.scalar(select(User.id).where(User.id == user_id).with_for_update())
    if report_id is not None:
        await parent(db, report_id, user_id)
    elif study_id is not None:
        from app.api.studies import own as own_study

        await own_study(db, study_id, user_id)
    item = await db.get(Attachment, file_id, with_for_update=True)
    if item is not None:
        if (
            item.user_id != user_id
            or item.report_id != report_id
            or item.study_id != study_id
            or item.state == "deleted"
        ):
            raise missing()
        if (item.name, item.size, item.sha256) != (body.name, body.size, body.sha256):
            raise ApiError(409, ErrorCode.FILE_CHANGED)
        return AttachmentOut.model_validate(item)
    used = await db.scalar(
        select(func.coalesce(func.sum(Attachment.size), 0)).where(
            Attachment.user_id == user_id,
        )
    )
    imaging_reserved = await db.scalar(
        select(func.coalesce(func.sum(ImagingImport.reserved_bytes), 0)).where(
            ImagingImport.user_id == user_id,
        )
    )
    used = (used or 0) + (imaging_reserved or 0)
    pending = await db.scalar(
        select(func.count())
        .select_from(Attachment)
        .where(
            Attachment.user_id == user_id,
            Attachment.state == "uploading",
        )
    )
    if (used or 0) + body.size > get_settings().storage_quota_bytes or (pending or 0) >= 10:
        raise ApiError(409, ErrorCode.FILE_QUOTA)
    key = str(uuid7())
    try:
        upload = await run_in_threadpool(file_storage().start, key)
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    item = Attachment(
        id=file_id,
        user_id=user_id,
        report_id=report_id,
        study_id=study_id,
        name=body.name,
        size=body.size,
        sha256=body.sha256,
        state="uploading",
        object_key=key,
        upload_id=upload,
        expires_at=datetime.now(UTC) + timedelta(hours=24),
    )
    db.add(item)
    await db.commit()
    response.status_code = 201
    return AttachmentOut.model_validate(item)


@router.post("/files/{file_id}/parts")
async def upload_parts(file_id: RecordId, user: CurrentUser, db: SessionDep) -> UploadPlan:
    item = await own(db, file_id, user.id)
    active(item)
    if item.upload_id is None:
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)
    try:
        storage = file_storage()
        parts = await run_in_threadpool(storage.parts, item.object_key, item.upload_id)
        urls = [
            storage.part_url(
                item.object_key, item.upload_id, n, min(PART_SIZE, item.size - (n - 1) * PART_SIZE)
            )
            for n in range(1, math.ceil(item.size / PART_SIZE) + 1)
        ]
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    return UploadPlan(
        part_size=PART_SIZE,
        urls=urls,
        uploaded=[UploadedPart(number=n, size=size) for n, _, size in parts],
    )


@router.post("/files/{file_id}/complete")
async def complete_file(file_id: RecordId, user: CurrentUser, db: SessionDep) -> AttachmentOut:
    await file_mutation(db)
    item = await own(db, file_id, user.id)
    if item.state == "ready":
        return AttachmentOut.model_validate(item)
    active(item)
    if item.upload_id is None:
        raise ApiError(409, ErrorCode.FILE_UPLOAD_CLOSED)
    storage = file_storage()
    try:
        try:
            parts = await run_in_threadpool(storage.parts, item.object_key, item.upload_id)
            expected = math.ceil(item.size / PART_SIZE)
            if len(parts) != expected or any(
                n != i or size != min(PART_SIZE, item.size - (i - 1) * PART_SIZE)
                for i, (n, _, size) in enumerate(parts, 1)
            ):
                raise ApiError(409, ErrorCode.FILE_INCOMPLETE)
            await run_in_threadpool(storage.finish, item.object_key, item.upload_id, parts)
        except ClientError as error:
            # Complete succeeded but its response/DB commit was lost. The staging object
            # is immutable once multipart is complete; Copy/validation below prove it.
            if error.response.get("Error", {}).get("Code") != "NoSuchUpload":
                raise
        await run_in_threadpool(storage.publish_copy, item.object_key, item.object_key)
        item.content_type = await run_in_threadpool(
            validated_content,
            storage,
            item.object_key,
            item.size,
            item.sha256,
        )
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    except ValueError, OSError, PyPdfError, Image.DecompressionBombError:
        item.state = "failed"
        await db.commit()
        raise ApiError(422, ErrorCode.FILE_INVALID) from None
    item.state = "ready"
    await db.commit()
    return AttachmentOut.model_validate(item)


@router.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    await file_mutation(db)
    item = await own(db, file_id, user.id)
    item.state = "deleted"
    await db.commit()


@router.get("/files/{file_id}/content", response_class=StreamingResponse)
async def download_file(
    file_id: RecordId,
    user: CurrentUser,
    db: SessionDep,
    byte_range: Annotated[str | None, Header(alias="Range")] = None,
) -> StreamingResponse:
    item = await own(db, file_id, user.id)
    if item.state != "ready":
        raise missing()
    try:
        selected = content_range(byte_range, item.size)
    except ValueError:
        raise ApiError(
            416, ErrorCode.FILE_RANGE, {"Content-Range": f"bytes */{item.size}"}
        ) from None
    start, end = selected if selected else (0, item.size - 1)
    chunks = file_storage().chunks(item.object_key, f"bytes={start}-{end}")
    # Open before headers are sent, so storage failures have a normal API response.
    try:
        first = await run_in_threadpool(next, chunks)
    except BotoCoreError, ClientError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    from itertools import chain

    headers = {
        "Content-Length": str(end - start + 1),
        "Accept-Ranges": "bytes",
        "Content-Disposition": "attachment; filename*=UTF-8''" + quote(item.name, safe=""),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    }
    if selected:
        headers["Content-Range"] = f"bytes {start}-{end}/{item.size}"
    return StreamingResponse(
        exact_chunks(chain([first], chunks), end - start + 1),
        status_code=206 if selected else 200,
        media_type=item.content_type,
        headers=headers,
    )
