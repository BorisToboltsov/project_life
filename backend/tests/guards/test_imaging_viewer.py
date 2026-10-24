"""I26: exact stored pixels, bounded frame transport, current owner and safe download."""

# Guard tests intentionally inspect process-local cache and concurrency bounds.
# pyright: reportPrivateUsage=false

import hashlib
import struct
import subprocess
from pathlib import Path
from uuid import uuid7

import jwt
import pytest
from httpx import AsyncClient
from pydicom.dataset import Dataset
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import imaging_viewer
from app.config import get_settings
from app.imaging import pixels
from app.models import HealthStudy, ImagingObject
from app.security import downloads
from tests.conftest import MakeUser
from tests.guards.test_attachments import MemoryStorage
from tests.guards.test_imaging_archive import dicom, encoded
from tests.imaging_viewer import ready

pytestmark = pytest.mark.anyio


async def test_sorted_enhanced_frames_keep_signed_pixels_and_per_frame_transforms(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user()
    row, storage = await ready(db, user, tmp_path)
    monkeypatch.setattr(imaging_viewer, "file_storage", lambda: storage)
    path = f"/api/studies/{row.anchor_id}/viewer"
    listed = await client.get(path, headers=user.headers)
    assert listed.status_code == 200
    assert listed.json()["series"][0]["frames"] == 2
    assert "instances" not in listed.json()
    for number, expected, slope in [(0, [-100, 0, 100, 200], 1), (1, [-2048, -1, 0, 2047], 3)]:
        meta = (await client.get(f"{path}/0/{number}", headers=user.headers)).json()
        assert meta["signed"]
        assert meta["photometric"] == "MONOCHROME1"
        assert (meta["frame"]["slope"], meta["frame"]["intercept"]) == (slope, -100)
        response = await client.get(f"{path}/0/{number}/pixels", headers=user.headers)
        assert response.status_code == 200
        assert response.content == struct.pack("<4h", *expected)
        assert response.headers["cache-control"] == "private, no-store"
    for suffix in ["/-1/0", "/0/-1/pixels", "/1/0", "/0/2/pixels"]:
        assert (await client.get(path + suffix, headers=user.headers)).status_code == 404
    # Warm cache does not bypass owner/deletion checks.
    stranger = await make_user()
    assert (await client.get(path + "/0/0/pixels", headers=stranger.headers)).status_code == 404
    await db.execute(delete(HealthStudy).where(HealthStudy.id == row.anchor_id))
    await db.commit()
    assert (await client.get(path + "/0/0/pixels", headers=user.headers)).status_code == 404


async def test_original_stream_range_scoped_cookie_and_logout(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user()
    row, storage = await ready(db, user, tmp_path)
    monkeypatch.setattr(imaging_viewer, "file_storage", lambda: storage)
    path = f"/api/studies/{row.anchor_id}"
    grant = await client.post(path + "/original-download", headers=user.headers)
    assert grant.status_code == 204
    cookie = grant.headers["set-cookie"]
    assert all(
        part in cookie
        for part in ["HttpOnly", "Secure", "SameSite=strict", "Max-Age=120", "Path=/api/studies/"]
    )
    token = client.cookies[downloads.COOKIE_NAME]
    response = await client.get(path + "/original", headers={"Range": "bytes=0-15"})
    assert response.status_code == 206
    assert response.content == storage.published[row.object_key][:16]
    assert response.headers["content-range"] == f"bytes 0-15/{row.size}"
    assert "attachment;" in response.headers["content-disposition"]
    assert (await client.get(path + "/original")).content == storage.published[row.object_key]
    assert (
        await client.get(path + "/original", headers={"Range": "bytes=999999999-"})
    ).status_code == 416
    assert (await client.get(path + "/viewer")).status_code == 401
    assert (await client.get(f"/api/studies/{uuid7()}/original")).status_code == 401
    assert (
        await client.get(path + "/original", headers={"Authorization": "Bearer invalid"})
    ).status_code == 401
    assert (await client.get(path, headers={"Authorization": f"Bearer {token}"})).status_code == 401
    stranger = await make_user()
    assert (await client.get(path + "/original", headers=stranger.headers)).status_code == 404
    await client.post("/api/auth/logout")
    assert (await client.get(path + "/original")).status_code == 401
    expired = jwt.encode(  # pyright: ignore[reportUnknownMemberType]
        {"sub": user.id, "aud": path + "/original", "exp": 1},
        get_settings().jwt_secret.get_secret_value(),
        algorithm="HS256",
    )  # pyright: ignore[reportUnknownMemberType]
    assert downloads.owner(expired, path + "/original") is None


async def test_unready_or_missing_object_never_returns_pixels(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user()
    row, storage = await ready(db, user, tmp_path)
    monkeypatch.setattr(imaging_viewer, "file_storage", lambda: storage)
    path = f"/api/studies/{row.anchor_id}/viewer/0/0/pixels"
    row.verified = False
    await db.commit()
    assert (await client.get(path, headers=user.headers)).status_code == 404
    row.verified = True
    row.state = "importing"
    await db.commit()
    assert (await client.get(path, headers=user.headers)).status_code == 404
    row.state = "ready"
    await db.commit()
    obj = await db.scalar(select(ImagingObject).where(ImagingObject.import_id == row.id))
    assert obj
    obj.sha256 = "0" * 64
    await db.commit()
    assert (await client.get(path, headers=user.headers)).status_code == 422
    await db.delete(obj)
    await db.commit()
    assert (await client.get(path, headers=user.headers)).status_code == 404


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (pixels.PixelBusy("busy"), 503),
        (pixels.PixelError("unsupported"), 422),
        (OSError("private path"), 503),
    ],
)
async def test_decoder_failure_has_safe_code(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    status: int,
) -> None:
    user = await make_user()
    row, storage = await ready(db, user, tmp_path)
    monkeypatch.setattr(imaging_viewer, "file_storage", lambda: storage)

    def fail(*args: object) -> bytes:
        raise failure

    monkeypatch.setattr(imaging_viewer, "decoded_frame", fail)
    result = await client.get(
        f"/api/studies/{row.anchor_id}/viewer/0/0/pixels", headers=user.headers
    )
    assert result.status_code == status
    assert result.json() == {
        "detail": "imaging_unsupported" if status == 422 else "file_storage_unavailable"
    }


@pytest.mark.parametrize(
    ("signed", "bits", "values"),
    [
        (False, 16, [0, 32768, 65535, 4095]),
        (True, 16, [-2048, -1, 0, 2047]),
        (False, 8, [0, 127, 128, 255]),
    ],
)
def test_decode_keeps_original_values(
    tmp_path: Path, signed: bool, bits: int, values: list[int]
) -> None:
    ds = dicom()
    ds.BitsAllocated = bits
    ds.BitsStored = bits
    ds.HighBit = bits - 1
    ds.PixelRepresentation = int(signed)
    ds.PixelData = struct.pack("<4" + ("B" if bits == 8 else "h" if signed else "H"), *values)
    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(encoded(ds))
    pixels.decode(source, target, 0)
    assert target.read_bytes() == struct.pack("<4" + ("h" if signed else "H"), *values)


@pytest.mark.parametrize(
    "kind", ["color", "limit", "lut", "presentation", "sigmoid", "truncated", "frame"]
)
def test_unsupported_pixels_are_explicit(tmp_path: Path, kind: str) -> None:
    ds = dicom()
    if kind == "color":
        ds.SamplesPerPixel = 3
    if kind == "limit":
        ds.Rows = 4000
        ds.Columns = 4000
    if kind == "lut":
        ds.ModalityLUTSequence = [Dataset()]
    if kind == "presentation":
        ds.PresentationLUTShape = "INVERSE"
    if kind == "sigmoid":
        ds.VOILUTFunction = "SIGMOID"
    if kind == "truncated":
        ds.PixelData = b"xx"
    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(encoded(ds))
    with pytest.raises(ValueError, match=r"pixel|frame|lut|bytes|data|reshape"):
        pixels.decode(source, target, 1 if kind == "frame" else 0)
    assert not target.exists()


def test_decoder_checks_integrity_bounds_cache_and_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = MemoryStorage()
    data = encoded(dicom())
    sha = hashlib.sha256(data).hexdigest()
    storage.published = {"one": data, "two": data}
    pixels._cache.clear()
    monkeypatch.setattr(pixels, "CACHE_BYTES", 8)
    assert len(pixels.decoded_frame(storage, "one", len(data), sha, 0)) == 8
    storage.published["one"] = b"changed"
    assert len(pixels.decoded_frame(storage, "one", len(data), sha, 0)) == 8
    pixels.decoded_frame(storage, "two", len(data), sha, 0)
    assert sum(map(len, pixels._cache.values())) <= 8
    with pytest.raises(pixels.PixelError, match="integrity_failed"):
        pixels.decoded_frame(storage, "one", len(data), sha, 0)
    pixels._cache.clear()
    pixels._slots.acquire()
    pixels._slots.acquire()
    try:
        with pytest.raises(pixels.PixelBusy):
            pixels.decoded_frame(storage, "two", len(data), sha, 0)
    finally:
        pixels._slots.release()
        pixels._slots.release()

    def timeout(*args: object, **kwargs: object) -> None:
        raise subprocess.TimeoutExpired("decoder", 30)

    monkeypatch.setattr(pixels.subprocess, "run", timeout)
    with pytest.raises(pixels.PixelBusy, match="decode_timeout"):
        pixels.decoded_frame(storage, "two", len(data), sha, 0)


@pytest.mark.parametrize(
    "name",
    [
        "MR_small.dcm",
        "MR_small_implicit.dcm",
        "MR_small_bigendian.dcm",
        "MR_small_RLE.dcm",
        "MR_small_jpeg_ls_lossless.dcm",
        "MR_small_jp2klossless.dcm",
    ],
)
def test_bundled_lossless_codecs_match_reference_pixels(tmp_path: Path, name: str) -> None:
    import pydicom

    root = Path(pydicom.__file__).parent / "data" / "test_files"
    reference, target = tmp_path / "reference", tmp_path / "frame"
    pixels.decode(root / "MR_small.dcm", reference, 0)
    pixels.decode(root / name, target, 0)
    assert target.read_bytes() == reference.read_bytes()
    assert hashlib.sha256(target.read_bytes()).hexdigest().startswith("88617aaa46138fb1")


def test_jpeg_baseline_matches_independent_decoder(tmp_path: Path) -> None:
    import io

    import numpy as np
    from PIL import Image
    from pydicom.encaps import encapsulate
    from pydicom.uid import JPEGBaseline8Bit

    ds = dicom()
    ds.Rows = ds.Columns = 16
    ds.BitsAllocated = ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    image = Image.fromarray(np.arange(256, dtype=np.uint8).reshape(16, 16))
    stream = io.BytesIO()
    image.save(stream, format="JPEG", quality=90)
    ds.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
    ds.PixelData = encapsulate([stream.getvalue()])
    source, target = tmp_path / "source", tmp_path / "frame"
    source.write_bytes(encoded(ds))
    pixels.decode(source, target, 0)
    actual = np.frombuffer(target.read_bytes(), dtype="<u2").reshape(16, 16)
    expected = np.asarray(Image.open(io.BytesIO(stream.getvalue())), dtype=np.uint16)
    # JPEG IDCT implementations can differ by the least significant bit.
    assert np.max(np.abs(actual.astype(np.int32) - expected.astype(np.int32))) <= 1


async def test_deletion_during_decode_revokes_in_flight_response(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.db import session_factory

    user = await make_user()
    row, storage = await ready(db, user, tmp_path)
    monkeypatch.setattr(imaging_viewer, "file_storage", lambda: storage)

    async def decoding(*args: object) -> bytes:
        async with session_factory() as other:
            await other.execute(delete(HealthStudy).where(HealthStudy.id == row.anchor_id))
            await other.commit()
        return b"\0" * 8

    monkeypatch.setattr(imaging_viewer, "run_in_threadpool", decoding)
    response = await client.get(
        f"/api/studies/{row.anchor_id}/viewer/0/0/pixels", headers=user.headers
    )
    assert response.status_code == 404
