"""ZIP upload -> inspection -> explicit selection -> immutable instance objects."""

import hashlib
from pathlib import Path
from uuid import uuid7

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import imaging
from app.imaging import processing
from app.models import ImagingImport, ImagingObject
from tests.conftest import MakeUser
from tests.guards.test_imaging_archive import archive, dicom, encoded
from tests.guards.test_imaging_storage import Storage

pytestmark = pytest.mark.anyio


class ImportStorage(Storage):
    def restore_object(self, key: str, source: Path) -> None:
        self.published[key] = source.read_bytes()


async def test_selected_studies_import_once_and_deleted_card_stays_deleted(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner, other = await make_user(), await make_user()
    first, second = dicom(), dicom(number=2)
    second.StudyInstanceUID = "1.2.3.99"
    data = archive(
        tmp_path, [("first.dcm", encoded(first)), ("second.dcm", encoded(second))]
    ).read_bytes()
    storage = ImportStorage()
    monkeypatch.setattr(imaging, "file_storage", lambda: storage)
    monkeypatch.setattr(processing, "file_storage", lambda: storage)
    study, import_id, second_id = uuid7(), uuid7(), uuid7()
    study_path, path = f"/api/studies/{study}", f"/api/imaging-imports/{import_id}"
    assert (
        await client.put(
            study_path, headers=owner.headers, json={"title": "CT", "local_date": "2026-10-22"}
        )
    ).status_code == 201
    body = {"name": "scan.zip", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    upload_path = f"{study_path}/imports/{import_id}"
    assert (await client.put(upload_path, headers=owner.headers, json=body)).status_code == 201
    assert (await client.put(upload_path, headers=owner.headers, json=body)).status_code == 200
    assert (
        await client.put(upload_path, headers=owner.headers, json={**body, "name": "changed.zip"})
    ).status_code == 409
    row = await db.get(ImagingImport, import_id)
    assert row is not None
    storage.data[row.object_key] = data
    assert (await client.post(f"{path}/parts", headers=owner.headers)).status_code == 200
    assert (await client.post(f"{path}/complete", headers=owner.headers)).json()[
        "state"
    ] == "inspecting"
    await processing.process_inspection(import_id)
    inspected = (await client.get(path, headers=owner.headers)).json()
    assert len(inspected["candidates"]) == 2
    assert (await client.get(path, headers=other.headers)).status_code == 404
    selection = {
        "studies": {
            str(first.StudyInstanceUID): str(study),
            str(second.StudyInstanceUID): str(second_id),
        }
    }
    assert (
        await client.post(f"{path}/confirm", headers=owner.headers, json=selection)
    ).status_code == 200
    assert (
        await client.post(f"{path}/confirm", headers=owner.headers, json=selection)
    ).status_code == 200
    # Delete one selected card before the background task runs: it must not be recreated.
    assert (
        await client.delete(f"/api/studies/{second_id}", headers=owner.headers)
    ).status_code == 204
    await processing.process_inspection(import_id)
    await processing.process_inspection(import_id)
    await db.refresh(row)
    assert row.state == "ready"
    objects = list(
        await db.scalars(select(ImagingObject).where(ImagingObject.import_id == import_id))
    )
    assert len(objects) == 1
    assert storage.published[objects[0].object_key] == encoded(first)
    assert storage.published[row.object_key] == data
    assert row.reserved_bytes == len(data) + len(encoded(first))
    assert (await client.get(f"/api/studies/{second_id}", headers=owner.headers)).status_code == 404
    assert (await client.delete(study_path, headers=owner.headers)).status_code == 204
    assert (await client.get(path, headers=owner.headers)).status_code == 404


async def test_upload_expiration_and_invalid_confirmation(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.guards.test_imaging_storage import seeded

    row = await seeded(db, make_user, b"archive")
    from app.security.tokens import create_access_token

    token, _ = create_access_token(row.user_id)
    headers = {"Authorization": f"Bearer {token}"}
    path = f"/api/imaging-imports/{row.id}"
    row.state = "uploading"
    await db.commit()
    monkeypatch.setattr(imaging, "file_storage", ImportStorage)
    assert (await client.post(f"{path}/parts", headers=headers)).status_code == 409
    assert (
        await client.post(
            f"{path}/confirm", headers=headers, json={"studies": {"1.2": str(uuid7())}}
        )
    ).status_code == 409
    assert (await client.delete(path, headers=headers)).status_code == 204
    assert (await client.get(path, headers=headers)).status_code == 404
