import hashlib
import io
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid7

import pytest
from httpx import AsyncClient
from PIL import Image
from pypdf import PdfWriter
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import attachments
from app.config import get_settings
from app.files import content_range
from app.models import Attachment
from app.services.file_storage import FileStorage
from tests.conftest import MakeUser
from tests.labs import add_report

pytestmark = pytest.mark.anyio


class MemoryStorage(FileStorage):
    def __init__(self) -> None:
        self.data: dict[str, bytes] = {}
        self.published: dict[str, bytes] = {}
        self.incomplete = False
        self.finished = 0

    def start(self, key: str) -> str:
        self.data[key] = b""
        return "upload"

    def part_url(self, key: str, upload_id: str, part: int, size: int) -> str:
        return f"/life-uploads/{key}?part={part}"

    def parts(self, key: str, upload_id: str) -> list[tuple[int, str, int]]:
        return [] if self.incomplete else [(1, "etag", len(self.data[key]))]

    def finish(self, key: str, upload_id: str, parts: list[tuple[int, str, int]]) -> None:
        self.finished += 1

    def publish_copy(self, source: str, target: str) -> None:
        self.published[target] = self.data[source]

    def chunks(self, key: str, byte_range: str | None = None) -> Iterator[bytes]:
        data = self.published[key]
        selected = content_range(byte_range, len(data))
        yield data if selected is None else data[selected[0] : selected[1] + 1]


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> MemoryStorage:
    result = MemoryStorage()
    monkeypatch.setattr(attachments, "file_storage", lambda: result)
    return result


def image_bytes() -> bytes:
    result = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(result, format="PNG")
    return result.getvalue()


async def test_upload_validate_repeat_range_delete(
    client: AsyncClient,
    make_user: MakeUser,
    storage: MemoryStorage,
    db: AsyncSession,
) -> None:
    user = await make_user()
    report = await add_report(client, user)
    file_id = uuid7()
    data = image_bytes()
    body = {"name": "photo.png", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    path = f"/api/lab-reports/{report}/files/{file_id}"
    created = await client.put(path, headers=user.headers, json=body)
    assert created.status_code == 201
    again = await client.put(path, headers=user.headers, json=body)
    assert again.status_code == 200
    assert again.json() == created.json()
    changed = await client.put(path, headers=user.headers, json={**body, "name": "other.png"})
    assert changed.status_code == 409
    row = await db.get(Attachment, file_id)
    assert row is not None
    storage.data[row.object_key] = data
    plan = await client.post(f"/api/files/{file_id}/parts", headers=user.headers)
    assert plan.status_code == 200
    assert len(plan.json()["urls"]) == 1
    storage.incomplete = True
    assert (
        await client.post(f"/api/files/{file_id}/complete", headers=user.headers)
    ).status_code == 409
    storage.incomplete = False
    complete = await client.post(f"/api/files/{file_id}/complete", headers=user.headers)
    assert complete.status_code == 200
    assert complete.json()["state"] == "ready"
    assert complete.json()["content_type"] == "image/png"
    assert (
        await client.post(f"/api/files/{file_id}/complete", headers=user.headers)
    ).status_code == 200
    assert storage.finished == 1
    fetched = await client.get(f"/api/files/{file_id}/content", headers=user.headers)
    assert fetched.content == data
    assert fetched.headers["cache-control"] == "private, no-store"
    assert fetched.headers["content-disposition"].startswith("attachment;")
    ranged = await client.get(
        f"/api/files/{file_id}/content", headers={**user.headers, "Range": "bytes=1-4"}
    )
    assert ranged.status_code == 206
    assert ranged.content == data[1:5]
    bad = await client.get(
        f"/api/files/{file_id}/content", headers={**user.headers, "Range": "bytes=999-"}
    )
    assert bad.status_code == 416
    stranger = await make_user()
    assert (
        await client.get(f"/api/files/{file_id}/content", headers=stranger.headers)
    ).status_code == 404
    assert (await client.get(f"/api/lab-reports/{report}/files", headers=user.headers)).json()[0][
        "state"
    ] == "ready"
    assert (await client.delete(f"/api/files/{file_id}", headers=user.headers)).status_code == 204
    assert (
        await client.get(f"/api/files/{file_id}/content", headers=user.headers)
    ).status_code == 404
    assert (await client.get(f"/api/lab-reports/{report}/files", headers=user.headers)).json() == []


@pytest.mark.parametrize(
    "invalid", [b"<script>alert(1)</script>", b"%PDF-1.7 invalid", b"wrong hash"]
)
async def test_invalid_content_never_published(
    client: AsyncClient,
    make_user: MakeUser,
    storage: MemoryStorage,
    invalid: bytes,
) -> None:
    user = await make_user()
    report = await add_report(client, user)
    file_id = uuid7()
    wrong_hash = invalid == b"wrong hash"
    if wrong_hash:
        invalid = image_bytes()
    body = {
        "name": "looks-like.pdf",
        "size": len(invalid),
        "sha256": hashlib.sha256(invalid).hexdigest(),
    }
    if wrong_hash:
        body["sha256"] = "0" * 64
    assert (
        await client.put(
            f"/api/lab-reports/{report}/files/{file_id}", headers=user.headers, json=body
        )
    ).status_code == 201
    key = next(iter(storage.data))
    storage.data[key] = invalid
    result = await client.post(f"/api/files/{file_id}/complete", headers=user.headers)
    assert result.status_code == 422
    assert (
        await client.get(f"/api/files/{file_id}/content", headers=user.headers)
    ).status_code == 404


async def test_parent_deletion_and_quota(
    client: AsyncClient,
    make_user: MakeUser,
    storage: MemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user()
    report = await add_report(client, user)
    file_id = uuid7()
    body = {"name": "a.png", "size": 4, "sha256": "0" * 64}
    monkeypatch.setattr(get_settings(), "storage_quota_bytes", 4)
    assert (
        await client.put(
            f"/api/lab-reports/{report}/files/{file_id}", headers=user.headers, json=body
        )
    ).status_code == 201
    assert (
        await client.put(
            f"/api/lab-reports/{report}/files/{uuid7()}", headers=user.headers, json=body
        )
    ).status_code == 409
    await client.delete(f"/api/lab-reports/{report}", headers=user.headers)
    assert (
        await client.post(f"/api/files/{file_id}/parts", headers=user.headers)
    ).status_code == 404
    assert storage.finished == 0


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("bytes=0-1", (0, 1)),
        ("bytes=-2", (8, 9)),
        ("bytes=8-", (8, 9)),
        ("bytes=8-99", (8, 9)),
    ],
)
def test_ranges(value: str | None, expected: tuple[int, int] | None) -> None:
    assert content_range(value, 10) == expected


@pytest.mark.parametrize("value", ["bytes=", "bytes=-0", "bytes=10-", "bytes=8-2", "bytes=0-1,3-4"])
def test_invalid_ranges(value: str) -> None:
    with pytest.raises(ValueError, match="range"):
        content_range(value, 10)


async def test_pdf_and_expiry(
    client: AsyncClient, make_user: MakeUser, storage: MemoryStorage, db: AsyncSession
) -> None:
    user = await make_user()
    report = await add_report(client, user)
    file_id = uuid7()
    buf = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(buf)
    data = buf.getvalue()
    body = {"name": "report.pdf", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    await client.put(f"/api/lab-reports/{report}/files/{file_id}", headers=user.headers, json=body)
    row = await db.get(Attachment, file_id)
    assert row is not None
    storage.data[row.object_key] = data
    result = await client.post(f"/api/files/{file_id}/complete", headers=user.headers)
    assert result.status_code == 200
    assert result.json()["content_type"] == "application/pdf"
    second = uuid7()
    await client.put(f"/api/lab-reports/{report}/files/{second}", headers=user.headers, json=body)
    expired = await db.get(Attachment, second)
    assert expired is not None
    expired.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()
    assert (
        await client.post(f"/api/files/{second}/parts", headers=user.headers)
    ).status_code == 409


async def test_backup_lock_blocks_file_mutation_and_parent_deletion(
    client: AsyncClient, make_user: MakeUser, db: AsyncSession
) -> None:
    from sqlalchemy import text

    from app.files import FILE_LOCK

    user = await make_user()
    report = await add_report(client, user)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": FILE_LOCK})
    try:
        response = await client.put(
            f"/api/lab-reports/{report}/files/{uuid7()}",
            headers=user.headers,
            json={"name": "scan.png", "size": 1, "sha256": "0" * 64},
        )
        assert response.status_code == 503
        response = await client.delete(f"/api/lab-reports/{report}", headers=user.headers)
        assert response.status_code == 503
        assert (await client.get("/api/lab-reports", headers=user.headers)).status_code == 200
    finally:
        await db.rollback()
    assert (
        await client.delete(f"/api/lab-reports/{report}", headers=user.headers)
    ).status_code == 204


def test_signed_part_binds_reserved_size() -> None:
    from urllib.parse import parse_qs, urlsplit

    storage = FileStorage()
    first = parse_qs(urlsplit(storage.part_url("object", "upload", 1, 100)).query)
    second = parse_qs(urlsplit(storage.part_url("object", "upload", 1, 101)).query)
    assert first["X-Amz-SignedHeaders"] == ["content-length;host"]
    assert first["X-Amz-Signature"] != second["X-Amz-Signature"]
