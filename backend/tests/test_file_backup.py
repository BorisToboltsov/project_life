import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from app import file_backup


def test_restore_refuses_incomplete_bundle(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="incomplete"):
        file_backup.restore(tmp_path, tmp_path, "unused")


@pytest.mark.parametrize("corruption", ["database", "object", "path", "plaintext"])
def test_restore_integrity_before_storage_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, corruption: str
) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "complete").write_text("complete")
    database = bundle / "database.sql.gz.age"
    database.write_bytes(b"database")
    source = tmp_path / "object.age"
    source.write_bytes(b"original")
    sha = hashlib.sha256(b"original").hexdigest()
    manifest: dict[str, Any] = {
        "version": 1,
        "database_cipher_sha256": file_backup.digest(database),
        "objects": [
            {"key": "key", "path": "object.age", "size": 8, "sha256": sha, "cipher_sha256": sha}
        ],
    }
    if corruption == "database":
        database.write_bytes(b"corrupt")
    elif corruption == "object":
        source.write_bytes(b"corrupt")
    elif corruption == "path":
        manifest["objects"][0]["path"] = "../outside.age"
    else:
        manifest["objects"][0]["sha256"] = "0" * 64
    (bundle / "manifest.json.age").write_text(json.dumps(manifest))

    def decrypt(source: Path, target: Path, identity: str) -> None:
        target.write_bytes(source.read_bytes())

    # An object without storage methods: any premature storage operation fails the test.
    monkeypatch.setattr(file_backup, "file_storage", object)
    monkeypatch.setattr(file_backup, "decrypt", decrypt)
    with pytest.raises(ValueError, match="integrity"):
        file_backup.restore(tmp_path, bundle, "unused")
