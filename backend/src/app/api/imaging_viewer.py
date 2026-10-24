"""Selected study metadata and one frame at a time, always owner-authorized."""

from itertools import chain
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Header, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.files import content_range, exact_chunks
from app.imaging.dicom import Frame, Instance, Manifest, Study
from app.imaging.pixels import MAX_PIXELS, PixelBusy, PixelError, decoded_frame
from app.models import HealthStudy, ImagingImport, ImagingObject, StudyImaging
from app.schemas import RecordId
from app.security import downloads
from app.services.file_storage import file_storage

router = APIRouter(tags=["imaging-viewer"], responses=error_responses(404, 422, 503))
PRIVATE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}


class ViewerSeries(BaseModel):
    index: int
    description: str
    frames: int
    geometric: bool


class ViewerStudy(BaseModel):
    series: list[ViewerSeries]
    warnings: list[str]


class ViewerFrame(BaseModel):
    rows: int
    columns: int
    signed: bool
    photometric: str
    modality: str
    frame: Frame


async def authorized(
    db: SessionDep, study_id: UUID, user_id: UUID
) -> tuple[ImagingImport, Manifest, Study]:
    found = (
        await db.execute(
            select(ImagingImport, StudyImaging)
            .join(StudyImaging, StudyImaging.import_id == ImagingImport.id)
            .join(HealthStudy, HealthStudy.id == StudyImaging.study_id)
            .where(
                StudyImaging.study_id == study_id,
                StudyImaging.user_id == user_id,
                HealthStudy.user_id == user_id,
                ImagingImport.user_id == user_id,
                ImagingImport.state == "ready",
                ImagingImport.verified.is_(True),
            )
        )
    ).one_or_none()
    if found is None or found[0].manifest is None:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    imported, link = found
    manifest = Manifest.model_validate(imported.manifest)
    study = next((s for s in manifest.studies if s.uid == link.dicom_uid), None)
    if study is None:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    return imported, manifest, study


def selected(manifest: Manifest, study: Study, series: int, number: int) -> tuple[Instance, Frame]:
    if not 0 <= series < len(study.stacks) or not 0 <= number < len(study.stacks[series].frames):
        raise ApiError(404, ErrorCode.NOT_FOUND)
    instance_index, frame_index = study.stacks[series].frames[number]
    instance = manifest.instances[instance_index]
    if instance.study_uid != study.uid:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    return instance, instance.frames[frame_index]


@router.get("/studies/{study_id}/viewer")
async def viewer(
    study_id: RecordId, user: CurrentUser, db: SessionDep, response: Response
) -> ViewerStudy:
    _, _, study = await authorized(db, study_id, user.id)
    response.headers.update(PRIVATE)
    return ViewerStudy(
        series=[
            ViewerSeries(
                index=i,
                description=s.description,
                frames=len(s.frames),
                geometric=s.ordering == "geometry",
            )
            for i, s in enumerate(study.stacks)
        ],
        warnings=study.warnings,
    )


@router.get("/studies/{study_id}/viewer/{series}/{number}")
async def frame_metadata(
    study_id: RecordId,
    series: int,
    number: int,
    user: CurrentUser,
    db: SessionDep,
    response: Response,
) -> ViewerFrame:
    _, manifest, study = await authorized(db, study_id, user.id)
    instance, item = selected(manifest, study, series, number)
    response.headers.update(PRIVATE)
    return ViewerFrame(
        rows=instance.rows,
        columns=instance.columns,
        signed=instance.signed,
        photometric=instance.photometric,
        modality=instance.modality,
        frame=item,
    )


@router.get("/studies/{study_id}/viewer/{series}/{number}/pixels", response_class=Response)
async def pixels(
    study_id: RecordId, series: int, number: int, user: CurrentUser, db: SessionDep
) -> Response:
    imported, manifest, study = await authorized(db, study_id, user.id)
    instance, item = selected(manifest, study, series, number)
    if instance.rows * instance.columns > MAX_PIXELS:
        raise ApiError(422, ErrorCode.IMAGING_UNSUPPORTED)
    obj = await db.scalar(
        select(ImagingObject).where(
            ImagingObject.import_id == imported.id, ImagingObject.member == instance.member
        )
    )
    if obj is None:
        raise ApiError(404, ErrorCode.NOT_FOUND)
    if (obj.sha256, obj.size) != (instance.sha256, instance.size):
        raise ApiError(422, ErrorCode.IMAGING_UNSUPPORTED)
    try:
        data = await run_in_threadpool(
            decoded_frame, file_storage(), obj.object_key, obj.size, obj.sha256, item.number
        )
    except PixelBusy, BotoCoreError, ClientError, OSError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    except PixelError:
        raise ApiError(422, ErrorCode.IMAGING_UNSUPPORTED) from None
    if len(data) != instance.rows * instance.columns * 2:
        raise ApiError(422, ErrorCode.IMAGING_UNSUPPORTED)
    # A slow decode must not restore access after the study was deleted meanwhile.
    await authorized(db, study_id, user.id)
    return Response(data, media_type="application/octet-stream", headers=PRIVATE)


@router.get("/studies/{study_id}/original", response_class=StreamingResponse)
async def original(
    study_id: RecordId,
    user: CurrentUser,
    db: SessionDep,
    byte_range: Annotated[str | None, Header(alias="Range")] = None,
) -> StreamingResponse:
    imported, _, _ = await authorized(db, study_id, user.id)
    try:
        selection = content_range(byte_range, imported.size)
    except ValueError:
        raise ApiError(
            416, ErrorCode.FILE_RANGE, {"Content-Range": f"bytes */{imported.size}"}
        ) from None
    start, end = selection if selection else (0, imported.size - 1)
    chunks = file_storage().chunks(imported.object_key, f"bytes={start}-{end}")
    try:
        first = await run_in_threadpool(next, chunks, None)
        if first is None:
            raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE)
    except BotoCoreError, ClientError, OSError:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE) from None
    headers = {
        **PRIVATE,
        "Content-Length": str(end - start + 1),
        "Accept-Ranges": "bytes",
        "Content-Disposition": "attachment; filename*=UTF-8''" + quote(imported.name, safe=""),
        "Content-Security-Policy": "sandbox; default-src 'none'",
    }
    if selection:
        headers["Content-Range"] = f"bytes {start}-{end}/{imported.size}"
    return StreamingResponse(
        exact_chunks(chain([first], chunks), end - start + 1),
        status_code=206 if selection else 200,
        media_type="application/zip",
        headers=headers,
    )


@router.post("/studies/{study_id}/original-download", status_code=204)
async def prepare_download(
    study_id: RecordId, user: CurrentUser, db: SessionDep, response: Response
) -> None:
    await authorized(db, study_id, user.id)
    downloads.permit(response, user.id, study_id)
    response.headers.update(PRIVATE)
