import hashlib
import struct
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID, uuid7

from sqlalchemy.ext.asyncio import AsyncSession

from app.imaging.dicom import inspect
from app.models import HealthStudy, ImagingImport, ImagingObject, StudyImaging
from tests.conftest import Account
from tests.guards.test_attachments import MemoryStorage
from tests.guards.test_imaging_archive import archive, dicom, encoded


async def ready(
    db: AsyncSession, owner: Account, directory: Path
) -> tuple[ImagingImport, MemoryStorage]:
    ds = dicom(enhanced=True)
    ds.PhotometricInterpretation = "MONOCHROME1"
    ds.PixelData = struct.pack("<8h", -2048, -1, 0, 2047, -100, 0, 100, 200)
    data = encoded(ds)
    path = archive(directory, [("scan.dcm", data)])
    manifest = inspect(path)
    study = HealthStudy(
        id=uuid7(), user_id=UUID(owner.id), title="Synthetic", local_date=date(2026, 10, 23)
    )
    db.add(study)
    await db.flush()
    row = ImagingImport(
        id=uuid7(),
        user_id=study.user_id,
        anchor_id=study.id,
        name="original.zip",
        size=path.stat().st_size,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        object_key=str(uuid7()),
        state="ready",
        verified=True,
        reserved_bytes=path.stat().st_size,
        expires_at=datetime.now(UTC),
        manifest=manifest.model_dump(mode="json"),
        selection={manifest.studies[0].uid: str(study.id)},
    )
    db.add(row)
    await db.flush()
    obj = ImagingObject(
        object_key=str(uuid7()),
        import_id=row.id,
        member=0,
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    db.add_all(
        [
            obj,
            StudyImaging(
                study_id=study.id,
                user_id=study.user_id,
                import_id=row.id,
                dicom_uid=manifest.studies[0].uid,
            ),
        ]
    )
    await db.commit()
    storage = MemoryStorage()
    storage.published = {row.object_key: path.read_bytes(), obj.object_key: data}
    return row, storage
