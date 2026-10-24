"""Bounded inspection process. Paths and parser diagnostics never enter logs."""

import json
import logging
import resource
import shutil
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from typing import cast

from pydantic import ValidationError

from app.imaging.archive import DEFAULT_LIMITS, ArchiveError
from app.imaging.dicom import Manifest, inspect

MAX_MANIFEST = 64 * 1024**2
ERROR_CODES = frozenset(
    {
        "unsafe_path",
        "encrypted_archive",
        "unsupported_compression",
        "archive_limit",
        "file_limit",
        "duplicate_path",
        "expanded_limit",
        "invalid_archive",
        "nested_archive",
        "conflicting_instance",
        "frame_limit",
        "no_studies",
    }
)


def inspect_archive(path: Path) -> Manifest:
    """The caller must already have verified the original's byte count and SHA-256."""
    with tempfile.TemporaryDirectory(prefix="life-imaging-") as directory:
        output = Path(directory) / "index.json"
        if shutil.disk_usage(directory).free < DEFAULT_LIMITS.member + MAX_MANIFEST:
            raise ArchiveError("scratch_full")
        with output.open("wb") as stream:
            try:
                result = subprocess.run(  # noqa: S603
                    [sys.executable, "-m", "app.imaging.process", str(path.resolve())],
                    stdout=stream,
                    stderr=subprocess.DEVNULL,
                    timeout=180,
                    check=False,
                    cwd=directory,
                )
            except subprocess.TimeoutExpired:
                raise ArchiveError("inspection_timeout") from None
        if result.returncode != 0 or output.stat().st_size > MAX_MANIFEST:
            raise ArchiveError("inspection_failed")
        raw = output.read_bytes()
        try:
            envelope = json.loads(raw)
            if isinstance(envelope, dict) and "error" in envelope:
                code = cast(dict[str, object], envelope)["error"]
                raise ArchiveError(
                    code if isinstance(code, str) and code in ERROR_CODES else "inspection_failed"
                )
            return Manifest.model_validate_json(raw)
        except json.JSONDecodeError, TypeError, ValidationError:
            raise ArchiveError("inspection_failed") from None


def main() -> None:
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    resource.setrlimit(resource.RLIMIT_FSIZE, (DEFAULT_LIMITS.member, DEFAULT_LIMITS.member))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    try:
        output = inspect(Path(sys.argv[1])).model_dump_json()
        if len(output.encode()) > MAX_MANIFEST:
            raise ArchiveError("inspection_failed")
    except ArchiveError as error:
        code = str(error)
        output = json.dumps({"error": code if code in ERROR_CODES else "inspection_failed"})
    except Exception:
        output = json.dumps({"error": "inspection_failed"})
    print(output)  # noqa: T201


if __name__ == "__main__":
    main()
