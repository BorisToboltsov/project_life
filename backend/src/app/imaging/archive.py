"""Read untrusted ZIPs without extracting archive-controlled paths.

Run in a resource-limited child process: DICOM parsing itself may allocate memory.
The byte limits below count bytes actually read, including skipped files.
"""

import hashlib
import stat
import tempfile
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO


class ArchiveError(ValueError):
    """Only a stable code; never include filenames or patient data in exceptions."""


@dataclass(frozen=True)
class Limits:
    archive: int = 2 * 1024**3
    expanded: int = 8 * 1024**3
    member: int = 1024**3
    files: int = 20_000
    frames: int = 100_000
    pixels_per_frame: int = 25_000_000


@dataclass
class Member:
    number: int
    name: str
    size: int
    sha256: str
    stream: BinaryIO


def _safe(info: zipfile.ZipInfo) -> None:
    name = info.filename
    path = PurePosixPath(name)
    mode = info.external_attr >> 16
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ":" in name
        or any(ord(char) < 32 for char in name)
        or ".." in path.parts
        or info.orig_filename != name
        or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))
    ):
        raise ArchiveError("unsafe_path")
    if info.flag_bits & 1:
        raise ArchiveError("encrypted_archive")
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise ArchiveError("unsupported_compression")


DEFAULT_LIMITS = Limits()


def members(path: Path, limits: Limits = DEFAULT_LIMITS) -> Iterator[Member]:
    """A yielded stream is valid only until the next iteration; never use extractall."""
    if path.stat().st_size > limits.archive:
        raise ArchiveError("archive_limit")
    total = 0
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > limits.files:
                raise ArchiveError("file_limit")
            names: set[str] = set()
            for info in entries:
                _safe(info)
                normalized = str(PurePosixPath(info.filename)).casefold()
                if normalized in names:
                    raise ArchiveError("duplicate_path")
                names.add(normalized)
            for number, info in enumerate(entries):
                if info.is_dir():
                    continue
                if info.file_size > limits.member or total + info.file_size > limits.expanded:
                    raise ArchiveError("expanded_limit")
                # No archive name reaches the filesystem. Spooling bounds RAM and a
                # single temporary file bounds scratch usage during inspection.
                with tempfile.TemporaryFile() as target, archive.open(info) as source:
                    size = 0
                    digest = hashlib.sha256()
                    prefix = b""
                    while chunk := source.read(1024 * 1024):
                        size += len(chunk)
                        total += len(chunk)
                        if size > limits.member or total > limits.expanded:
                            raise ArchiveError("expanded_limit")
                        if not prefix:
                            prefix = chunk[:512]
                        digest.update(chunk)
                        target.write(chunk)
                    if size != info.file_size:
                        raise ArchiveError("invalid_archive")
                    if (
                        prefix.startswith(
                            (
                                b"PK\x03\x04",
                                b"PK\x05\x06",
                                b"7z\xbc\xaf",
                                b"Rar!",
                                b"\x1f\x8b",
                                b"BZh",
                                b"\xfd7zXZ\x00",
                            )
                        )
                        or prefix[257:262] == b"ustar"
                    ):
                        raise ArchiveError("nested_archive")
                    target.seek(0)
                    yield Member(number, info.filename, size, digest.hexdigest(), target)
    except (zipfile.BadZipFile, EOFError, NotImplementedError, RuntimeError) as error:
        raise ArchiveError("invalid_archive") from error
