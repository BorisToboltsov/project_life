"""Original integrity, atomic inspection, ownership and shared archive lifetime."""

import hashlib
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid7

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import file_backup, file_maintenance
from app.config import get_settings
from app.imaging import processing
from app.imaging.archive import ArchiveError
from app.models import HealthStudy, ImagingImport, ImagingObject, StudyImaging
from app.security.tokens import create_access_token
from tests.conftest import MakeUser
from tests.guards.test_attachments import MemoryStorage
from tests.guards.test_imaging_archive import archive, dicom, encoded

pytestmark = pytest.mark.anyio


class Storage(MemoryStorage):
    staging = "staging"
    objects = "objects"

    def list_objects(self, bucket: str) -> list[tuple[str, datetime]]:
        return (
            [(key, datetime.now(UTC) - timedelta(days=2)) for key in self.published]
            if bucket == self.objects
            else []
        )

    def delete(self, key: str) -> None:
        self.published.pop(key, None)

    def list_uploads(self) -> list[tuple[str, str, datetime]]:
        return []


async def seeded(db: AsyncSession, make_user: MakeUser, data: bytes) -> ImagingImport:
    user = await make_user()
    study = HealthStudy(
        id=uuid7(), user_id=UUID(user.id), title="CT", local_date=date(2026, 10, 22)
    )
    db.add(study)
    await db.flush()
    row = ImagingImport(
        id=uuid7(),
        user_id=study.user_id,
        anchor_id=study.id,
        name="private.zip",
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        object_key=str(uuid7()),
        state="inspecting",
        reserved_bytes=len(data) + 8 * 1024**3,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    db.add(row)
    await db.commit()
    return row


async def test_inspection_persists_once_and_preserves_original(
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = archive(tmp_path, [("scan.dcm", encoded(dicom()))]).read_bytes()
    row = await seeded(db, make_user, data)
    storage = Storage()
    storage.published[row.object_key] = data
    monkeypatch.setattr(processing, "file_storage", lambda: storage)
    await processing.process_inspection(row.id)
    await db.refresh(row)
    assert row.state == "awaiting_confirmation"
    assert row.verified
    assert row.manifest
    assert len(row.manifest["studies"]) == 1
    storage.published.clear()
    await processing.process_inspection(row.id)  # Redelivery never reads bytes again.
    await processing.process_inspection(uuid7())
    await db.refresh(row)
    assert row.state == "awaiting_confirmation"


@pytest.mark.parametrize("data", [b"short", b"longer-than-expected"])
async def test_integrity_failure_never_publishes_manifest(
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
    data: bytes,
) -> None:
    row = await seeded(db, make_user, b"expected")
    storage = Storage()
    storage.published[row.object_key] = data
    monkeypatch.setattr(processing, "file_storage", lambda: storage)
    await processing.process_inspection(row.id)
    await db.refresh(row)
    assert (row.state, row.failure, row.manifest, row.verified) == (
        "failed",
        "integrity_failed",
        None,
        False,
    )


async def test_transient_failure_rolls_back_and_deleted_parent_cannot_resurrect(
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = await seeded(db, make_user, b"archive")
    monkeypatch.setattr(processing, "file_storage", Storage)

    def unavailable(*args: object) -> None:
        raise ArchiveError("scratch_full")

    monkeypatch.setattr(processing, "inspect_original", unavailable)
    with pytest.raises(ArchiveError, match="scratch_full"):
        await processing.process_inspection(row.id)
    await db.refresh(row)
    assert row.state == "inspecting"
    assert row.manifest is None
    await db.execute(delete(HealthStudy).where(HealthStudy.id == row.anchor_id))
    await db.commit()
    await processing.process_inspection(row.id)
    await db.refresh(row)
    assert row.state == "deleted"


async def test_shared_original_and_derived_survive_until_last_study_deleted(
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = await seeded(db, make_user, b"original")
    second = HealthStudy(id=uuid7(), user_id=row.user_id, title="MR", local_date=date(2026, 10, 22))
    db.add(second)
    await db.flush()
    row.state, row.verified = "ready", True
    db.add(
        StudyImaging(study_id=second.id, user_id=row.user_id, import_id=row.id, dicom_uid="1.2.3")
    )
    obj = ImagingObject(
        object_key=str(uuid7()), import_id=row.id, member=0, size=3, sha256="a" * 64
    )
    db.add(obj)
    await db.commit()
    storage = Storage()
    storage.published.update(
        {row.object_key: b"original", obj.object_key: b"dcm", "orphan": b"old"}
    )
    monkeypatch.setattr(file_maintenance, "file_storage", lambda: storage)
    await db.execute(delete(HealthStudy).where(HealthStudy.id == row.anchor_id))
    await db.commit()
    backup = list((await db.execute(text(file_backup.BACKUP_OBJECTS_SQL))).mappings())
    assert {item["object_key"] for item in backup} == {row.object_key, obj.object_key}
    await db.commit()
    assert await file_maintenance.cleanup() == 0
    assert set(storage.published) == {row.object_key, obj.object_key}
    await db.delete(second)
    await db.commit()
    assert await file_maintenance.cleanup() == 1
    assert storage.published == {}


async def test_database_rejects_cross_owner_study_link(
    db: AsyncSession, make_user: MakeUser
) -> None:
    row = await seeded(db, make_user, b"archive")
    other = await make_user()
    study = HealthStudy(
        id=uuid7(), user_id=UUID(other.id), title="MR", local_date=date(2026, 10, 22)
    )
    db.add(study)
    await db.commit()
    db.add(
        StudyImaging(study_id=study.id, user_id=study.user_id, import_id=row.id, dicom_uid="1.2.3")
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_archive_reservation_blocks_attachment_quota_bypass(
    db: AsyncSession,
    make_user: MakeUser,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = await seeded(db, make_user, b"archive")
    monkeypatch.setattr(get_settings(), "storage_quota_bytes", row.reserved_bytes)
    token, _ = create_access_token(row.user_id)
    response = await client.put(
        f"/api/studies/{row.anchor_id}/files/{uuid7()}",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "conclusion.pdf", "size": 100, "sha256": "a" * 64},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "file_quota"
