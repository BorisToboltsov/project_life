"""Study ownership, conclusion files and deletion contracts."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid7

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import attachments
from app.models import Attachment
from tests.conftest import MakeUser
from tests.guards.test_attachments import MemoryStorage, image_bytes

pytestmark = pytest.mark.anyio


async def test_study_update_list_and_delete(client: AsyncClient, make_user: MakeUser) -> None:
    owner, other = await make_user(), await make_user()
    path = f"/api/studies/{uuid7()}"
    body = {
        "title": "CT chest",
        "local_date": "2026-10-20",
        "institution": "Clinic",
        "note": "Follow-up",
    }
    created = await client.put(path, headers=owner.headers, json=body)
    assert created.status_code == 201
    updated = await client.put(path, headers=owner.headers, json={**body, "title": "MRI"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "MRI"
    assert len((await client.get("/api/studies", headers=owner.headers)).json()) == 1
    assert (await client.get("/api/studies", headers=other.headers)).json() == []
    assert (await client.get(path, headers=other.headers)).status_code == 404
    assert (await client.delete(path, headers=owner.headers)).status_code == 204
    assert (await client.get(path, headers=owner.headers)).status_code == 404


async def test_conclusion_upload_and_deleted_study_closes_all_file_routes(
    client: AsyncClient,
    make_user: MakeUser,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = MemoryStorage()
    monkeypatch.setattr(attachments, "file_storage", lambda: storage)
    owner, other = await make_user(), await make_user()
    study_id, file_id = uuid7(), uuid7()
    path = f"/api/studies/{study_id}"
    assert (
        await client.put(
            path, headers=owner.headers, json={"title": "CT", "local_date": "2026-10-20"}
        )
    ).status_code == 201
    data = image_bytes()
    body = {"name": "conclusion.png", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    created = await client.put(f"{path}/files/{file_id}", headers=owner.headers, json=body)
    assert created.status_code == 201
    assert (
        await client.put(f"{path}/files/{file_id}", headers=owner.headers, json=body)
    ).status_code == 200
    row = await db.get(Attachment, file_id)
    assert row is not None
    storage.data[row.object_key] = data
    assert (
        await client.post(f"/api/files/{file_id}/complete", headers=owner.headers)
    ).status_code == 200
    assert (
        await client.get(f"/api/files/{file_id}/content", headers=owner.headers)
    ).content == data
    assert len((await client.get(f"{path}/files", headers=owner.headers)).json()) == 1
    for method, suffix in [
        ("GET", "content"),
        ("POST", "parts"),
        ("POST", "complete"),
        ("DELETE", ""),
    ]:
        route = f"/api/files/{file_id}" + (f"/{suffix}" if suffix else "")
        assert (await client.request(method, route, headers=other.headers)).status_code == 404
    assert (await client.delete(path, headers=owner.headers)).status_code == 204
    for method, suffix in [
        ("GET", "content"),
        ("POST", "parts"),
        ("POST", "complete"),
        ("DELETE", ""),
    ]:
        route = f"/api/files/{file_id}" + (f"/{suffix}" if suffix else "")
        assert (await client.request(method, route, headers=owner.headers)).status_code == 404
    await db.refresh(row)
    assert row.study_id is None
    assert row.user_id == UUID(owner.id)


async def test_database_rejects_attachment_of_another_users_study(
    client: AsyncClient, make_user: MakeUser, db: AsyncSession
) -> None:
    owner, other = await make_user(), await make_user()
    study_id = uuid7()
    assert (
        await client.put(
            f"/api/studies/{study_id}",
            headers=owner.headers,
            json={"title": "CT", "local_date": "2026-10-20"},
        )
    ).status_code == 201
    db.add(
        Attachment(
            id=uuid7(),
            user_id=UUID(other.id),
            study_id=study_id,
            name="test",
            size=1,
            sha256="0" * 64,
            state="uploading",
            object_key=str(uuid7()),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
