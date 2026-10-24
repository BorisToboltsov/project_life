"""Durable inspection transition; retries never publish a partial index."""

import hashlib
import shutil
import tempfile
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid5

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.db import session_factory
from app.files import file_mutation
from app.imaging.archive import DEFAULT_LIMITS, ArchiveError
from app.imaging.dicom import Manifest
from app.imaging.extraction import extract_archive
from app.imaging.process import inspect_archive
from app.models import ImagingImport, ImagingObject, StudyImaging, User
from app.services.file_storage import FileStorage, file_storage


@contextmanager
def original(
    storage: FileStorage, key: str, size: int, sha256: str, extra: int = 0
) -> Generator[Path]:
    """Only inspect the immutable private copy after checking every byte."""
    with tempfile.TemporaryDirectory(prefix="life-original-") as directory:
        if shutil.disk_usage(directory).free < size + DEFAULT_LIMITS.member + extra:
            raise ArchiveError("scratch_full")
        path = Path(directory) / "original.zip"
        digest = hashlib.sha256()
        actual = 0
        with path.open("wb") as output:
            for chunk in storage.chunks(key):
                actual += len(chunk)
                if actual > size:
                    raise ArchiveError("integrity_failed")
                digest.update(chunk)
                output.write(chunk)
        if actual != size or digest.hexdigest() != sha256:
            raise ArchiveError("integrity_failed")
        yield path


def inspect_original(storage: FileStorage, key: str, size: int, sha256: str) -> Manifest:
    with original(storage, key, size, sha256) as path:
        return inspect_archive(path)


async def process_inspection(import_id: UUID) -> None:
    async with session_factory() as db:
        await file_mutation(db)
        # Always lock owner before import/parent, also in API mutations and deletion.
        owner_id = await db.scalar(
            select(ImagingImport.user_id).where(ImagingImport.id == import_id)
        )
        if owner_id is None:
            return
        await db.scalar(select(User.id).where(User.id == owner_id).with_for_update())
        row = await db.get(ImagingImport, import_id, with_for_update=True)
        if row is None or row.state not in {"inspecting", "importing"}:
            return
        linked = await db.scalar(
            select(StudyImaging.study_id).where(StudyImaging.import_id == row.id).limit(1)
        )
        if row.anchor_id is None and linked is None:
            row.state = "deleted"
            await db.commit()
            return
        if row.state == "importing":
            uids = set(
                await db.scalars(
                    select(StudyImaging.dicom_uid).where(StudyImaging.import_id == row.id)
                )
            )
            if not uids:
                row.state = "deleted"
            else:
                objects = await run_in_threadpool(import_selected, file_storage(), row, uids)
                db.add_all(objects)
                row.reserved_bytes = row.size + sum(obj.size for obj in objects)
                row.state = "ready"
            await db.commit()
            return
        try:
            manifest = await run_in_threadpool(
                inspect_original, file_storage(), row.object_key, row.size, row.sha256
            )
        except ArchiveError as error:
            # Resource pressure can clear on another attempt; preserve durable state.
            if str(error) in {"scratch_full", "inspection_timeout", "inspection_failed"}:
                raise
            row.state = "failed"
            row.failure = str(error)
        else:
            row.manifest = manifest.model_dump(mode="json")
            row.verified = True
            row.failure = None
            row.state = "awaiting_confirmation"
        await db.commit()


def import_selected(
    storage: FileStorage, row: ImagingImport, uids: set[str]
) -> list[ImagingObject]:
    manifest = Manifest.model_validate(row.manifest)
    instances = [item for item in manifest.instances if item.study_uid in uids]
    expanded = sum(item.size for item in instances)
    if expanded + row.size > row.reserved_bytes:
        raise ArchiveError("expanded_limit")
    with original(storage, row.object_key, row.size, row.sha256, expanded) as path:
        destination = path.parent / "selected"
        destination.mkdir()
        extract_archive(path, destination, instances)
        objects: list[ImagingObject] = []
        for instance in instances:
            source = destination / str(instance.member)
            # Verify the actual exported bytes before making them part of the ready index.
            with source.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if source.stat().st_size != instance.size or digest != instance.sha256:
                raise ArchiveError("integrity_failed")
            key = str(uuid5(row.id, str(instance.member)))
            storage.restore_object(key, source)
            objects.append(
                ImagingObject(
                    object_key=key,
                    import_id=row.id,
                    member=instance.member,
                    size=instance.size,
                    sha256=instance.sha256,
                )
            )
        return objects
