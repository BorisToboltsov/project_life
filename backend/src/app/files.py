"""File integrity, content validation and backup coordination."""

import hashlib
import re
import subprocess
import sys
import tempfile
from collections.abc import Iterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, ErrorCode
from app.services.file_storage import FileStorage

# Shared by attachment mutations, parent deletion, cleanup and the backup coordinator.
FILE_LOCK = 130013


async def file_mutation(db: AsyncSession) -> None:
    available = await db.scalar(
        text("SELECT pg_try_advisory_xact_lock_shared(:key)"), {"key": FILE_LOCK}
    )
    if not available:
        raise ApiError(503, ErrorCode.FILE_STORAGE_UNAVAILABLE)


def validated_content(storage: FileStorage, key: str, size: int, sha256: str) -> str:
    """Validate the PRIVATE copy; never trust an extension, MIME or mutable staging key."""
    with tempfile.NamedTemporaryFile() as stream:
        digest = hashlib.sha256()
        actual = 0
        for chunk in storage.chunks(key):
            actual += len(chunk)
            if actual > size:
                raise ValueError("file size")
            digest.update(chunk)
            stream.write(chunk)
        if actual != size or digest.hexdigest() != sha256:
            raise ValueError("file integrity")
        stream.flush()
        try:
            result = subprocess.run(  # noqa: S603 -- interpreter and module are fixed; no shell
                [sys.executable, "-m", "app.file_validation", stream.name],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=True,
                text=True,
            )
        except subprocess.SubprocessError:
            raise ValueError("unsupported document") from None
        mime = result.stdout.strip()
        if mime not in {"application/pdf", "image/jpeg", "image/png"}:
            raise ValueError("unsupported document")
        return mime


def content_range(value: str | None, size: int) -> tuple[int, int] | None:
    if value is None:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()):
        raise ValueError("range")
    first, last = match.groups()
    if not first:
        start, end = max(0, size - int(last)), size - 1
    else:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    if start > end or start >= size:
        raise ValueError("range")
    return start, end


def exact_chunks(chunks: Iterator[bytes], expected: int) -> Iterator[bytes]:
    count = 0
    for chunk in chunks:
        count += len(chunk)
        if count > expected:
            raise ValueError("invalid storage response")
        yield chunk
    if count != expected:
        raise ValueError("truncated storage response")
