"""Periodic cleanup of upload sessions and unreferenced objects."""

import asyncio
from datetime import UTC, datetime, timedelta

from botocore.exceptions import ClientError
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.db import session_factory
from app.files import file_mutation
from app.models import Attachment, ImagingImport, ImagingObject, StudyImaging
from app.services.file_storage import file_storage


async def cleanup() -> int:
    storage = file_storage()
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    removed = 0
    async with session_factory() as db:
        await file_mutation(db)
        rows = list(await db.scalars(select(Attachment).with_for_update()))
        for row in rows:
            if row.state == "uploading" and row.expires_at <= datetime.now(UTC):
                row.state = "failed"
            if (row.report_id is None and row.study_id is None) or row.state in {
                "failed",
                "deleted",
            }:
                if row.expires_at > datetime.now(UTC):
                    continue
                await run_in_threadpool(storage.delete, row.object_key)
                await db.delete(row)
                removed += 1
        live = {row.object_key for row in rows if row not in db.deleted}
        imports = list(await db.scalars(select(ImagingImport).with_for_update()))
        linked = set(await db.scalars(select(StudyImaging.import_id)))
        for item in imports:
            if item.state == "uploading" and item.expires_at <= datetime.now(UTC):
                item.state = "failed"
            orphan = item.anchor_id is None and item.id not in linked
            if (orphan or item.state in {"failed", "deleted"}) and item.expires_at <= datetime.now(
                UTC
            ):
                objects = list(
                    await db.scalars(
                        select(ImagingObject).where(ImagingObject.import_id == item.id)
                    )
                )
                for obj in objects:
                    await run_in_threadpool(storage.delete, obj.object_key)
                await run_in_threadpool(storage.delete, item.object_key)
                await db.delete(item)
                removed += 1
            else:
                live.add(item.object_key)
        await db.flush()
        live.update(await db.scalars(select(ImagingObject.object_key)))
        # Orphans from an interrupted transaction or deleted user have no metadata row.
        for key, modified in await run_in_threadpool(storage.list_objects, storage.objects):
            if key not in live and modified < cutoff:
                await run_in_threadpool(storage.delete, key)
        for key, modified in await run_in_threadpool(storage.list_objects, storage.staging):
            if modified < cutoff:
                await run_in_threadpool(storage.delete_staging, key)
        for key, upload, initiated in await run_in_threadpool(storage.list_uploads):
            if initiated < cutoff:
                try:
                    await run_in_threadpool(storage.abort, key, upload)
                except ClientError as error:
                    if error.response.get("Error", {}).get("Code") != "NoSuchUpload":
                        raise
        await db.commit()
    return removed


async def main() -> None:
    while True:
        try:
            await cleanup()
        except Exception:
            # No object keys, SDK messages or medical data in logs. The next pass retries.
            print("file_cleanup_failed", flush=True)  # noqa: T201
        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(main())
