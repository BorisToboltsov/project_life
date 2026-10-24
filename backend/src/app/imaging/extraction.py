"""Bounded extraction of selected, already inspected instances into numeric paths."""

import json
import logging
import resource
import shutil
import subprocess
import sys
import warnings
from pathlib import Path

from app.imaging.archive import DEFAULT_LIMITS, ArchiveError, members
from app.imaging.dicom import Instance


def extract(path: Path, destination: Path, instances: list[Instance]) -> None:
    selected = {item.member: item for item in instances}
    for member in members(path):
        expected = selected.pop(member.number, None)
        if expected is None:
            continue
        if (member.size, member.sha256) != (expected.size, expected.sha256):
            raise ArchiveError("integrity_failed")
        with (destination / str(member.number)).open("xb") as target:
            shutil.copyfileobj(member.stream, target, length=1024 * 1024)
    if selected:
        raise ArchiveError("integrity_failed")


def extract_archive(path: Path, destination: Path, instances: list[Instance]) -> None:
    selection = destination / "selection.json"
    selection.write_text(json.dumps([item.model_dump() for item in instances]))
    try:
        result = subprocess.run(  # noqa: S603 -- fixed interpreter/module, no shell
            [sys.executable, "-m", "app.imaging.extraction", str(path), str(destination)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=180,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise ArchiveError("extraction_timeout") from None
    if result.returncode != 0:
        raise ArchiveError("extraction_failed")


def main() -> None:
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    resource.setrlimit(resource.RLIMIT_FSIZE, (DEFAULT_LIMITS.member, DEFAULT_LIMITS.member))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    try:
        path, destination = Path(sys.argv[1]), Path(sys.argv[2])
        raw = json.loads((destination / "selection.json").read_bytes())
        extract(path, destination, [Instance.model_validate(item) for item in raw])
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
