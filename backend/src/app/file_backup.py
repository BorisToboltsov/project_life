"""Encrypted, incremental file bundles coordinated with a PostgreSQL snapshot.

Runs in an ephemeral backend container with /backups mounted. Only the public age
recipient is needed for backup. Restore requires an explicitly mounted private key.
"""

import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.files import FILE_LOCK
from app.services.file_storage import file_storage

BACKUP_OBJECTS_SQL = (
    "SELECT a.object_key, a.sha256, a.size FROM attachments a "
    "LEFT JOIN lab_reports r ON a.report_id=r.id "
    "LEFT JOIN health_studies s ON a.study_id=s.id "
    "WHERE a.state='ready' AND (a.user_id=r.user_id OR a.user_id=s.user_id) "
    "UNION ALL SELECT i.object_key, i.sha256, i.size FROM imaging_imports i "
    "WHERE i.verified AND i.state NOT IN ('failed','deleted') AND "
    "(i.anchor_id IS NOT NULL OR EXISTS "
    "(SELECT 1 FROM study_imaging s WHERE s.import_id=i.id)) "
    "UNION ALL SELECT o.object_key, o.sha256, o.size FROM imaging_objects o "
    "JOIN imaging_imports i ON i.id=o.import_id WHERE i.state='ready' AND "
    "EXISTS (SELECT 1 FROM study_imaging s WHERE s.import_id=i.id)"
)


def executable(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError("backup tool missing")
    return path


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def environment() -> dict[str, str]:
    url = make_url(get_settings().database_url)
    return {
        **os.environ,
        "PGHOST": url.host or "localhost",
        "PGPORT": str(url.port or 5432),
        "PGUSER": url.username or "life",
        "PGPASSWORD": url.password or "",
        "PGDATABASE": url.database or "life",
    }


def encrypt(source: Path, target: Path, recipient: str) -> None:
    temp = target.with_suffix(target.suffix + ".part")
    try:
        with temp.open("wb") as output:
            subprocess.run(  # noqa: S603 -- fixed executables, argument arrays, no shell
                [executable("age"), "-r", recipient, str(source)],
                stdout=output,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def decrypt(source: Path, target: Path, identity: str) -> None:
    with target.open("wb") as output:
        subprocess.run(  # noqa: S603 -- fixed executables, argument arrays, no shell
            [executable("age"), "-d", "-i", identity, str(source)],
            stdout=output,
            stderr=subprocess.DEVNULL,
            check=True,
        )


def backup(root: Path, recipient: str, label: str) -> Path:
    if not recipient.startswith("age1") or not label.isalnum():
        raise ValueError("invalid backup configuration")
    root.mkdir(parents=True, exist_ok=True)
    storage = file_storage()
    pg_env = environment()
    dsn = (
        make_url(get_settings().database_url)
        .set(drivername="postgresql")
        .render_as_string(hide_password=False)
    )
    with psycopg.Connection[dict[str, Any]].connect(
        dsn, autocommit=True, row_factory=dict_row
    ) as conn:
        # Session lock lasts through object copy: cleanup cannot remove any source.
        conn.execute("SELECT pg_advisory_lock(%s)", [FILE_LOCK])
        try:
            with conn.transaction(), tempfile.TemporaryDirectory() as directory:
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                snapshot = conn.execute("SELECT pg_export_snapshot() AS id").fetchone()
                if snapshot is None:
                    raise ValueError("missing snapshot")
                rows = conn.execute(BACKUP_OBJECTS_SQL).fetchall()
                temp = Path(directory)
                bundle = root / (datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ") + "-" + label)
                bundle.mkdir()
                dump = temp / "database.sql"
                with dump.open("wb") as output:
                    subprocess.run(  # noqa: S603 -- fixed executables, argument arrays, no shell
                        [
                            executable("pg_dump"),
                            "--snapshot=" + snapshot["id"],
                            "--no-owner",
                            "--clean",
                            "--if-exists",
                        ],
                        env=pg_env,
                        stdout=output,
                        stderr=subprocess.DEVNULL,
                        check=True,
                    )
                zipped = temp / "database.sql.gz"
                with dump.open("rb") as source, gzip.open(zipped, "wb") as output:
                    while block := source.read(1024 * 1024):
                        output.write(block)
                encrypt(zipped, bundle / "database.sql.gz.age", recipient)
                generation = hashlib.sha256(recipient.encode()).hexdigest()[:16]
                objects = root / "objects" / generation
                objects.mkdir(parents=True, exist_ok=True)
                manifest: dict[str, Any] = {
                    "version": 1,
                    "objects": [],
                    "database_cipher_sha256": digest(bundle / "database.sql.gz.age"),
                }
                for row in rows:
                    # Object key is generated internally, never a supplied filename.
                    key = row["object_key"]
                    target = objects / (key + ".age")
                    checksum = target.with_suffix(".sha256")
                    if target.exists() and (
                        not checksum.exists() or digest(target) != checksum.read_text()
                    ):
                        # Re-encrypting at the same path would invalidate older manifests.
                        raise ValueError("existing backup object integrity")
                    if not target.exists():
                        original = temp / "object"
                        with original.open("wb") as output:
                            for block in storage.chunks(key):
                                output.write(block)
                        if (
                            original.stat().st_size != row["size"]
                            or digest(original) != row["sha256"]
                        ):
                            raise ValueError("backup source integrity")
                        encrypt(original, target, recipient)
                        checksum.write_text(digest(target))
                        original.unlink()
                    manifest["objects"].append(
                        {
                            "key": key,
                            "size": row["size"],
                            "sha256": row["sha256"],
                            "path": str(target.relative_to(root)),
                            "cipher_sha256": checksum.read_text(),
                        }
                    )
                plain_manifest = temp / "manifest.json"
                plain_manifest.write_text(json.dumps(manifest))
                encrypt(plain_manifest, bundle / "manifest.json.age", recipient)
                # No medical fields in retention index. Its checksum detects accidental damage.
                references = json.dumps([obj["path"] for obj in manifest["objects"]])
                (bundle / "references.json").write_text(references)
                (bundle / "complete.part").write_text(
                    hashlib.sha256(references.encode()).hexdigest()
                )
                (bundle / "complete.part").replace(bundle / "complete")
                return bundle
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", [FILE_LOCK])


def restore(root: Path, bundle: Path, identity: str) -> None:
    if not (bundle / "complete").is_file():
        raise ValueError("incomplete backup")
    storage = file_storage()
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        manifest_path = temp / "manifest.json"
        decrypt(bundle / "manifest.json.age", manifest_path, identity)
        manifest = json.loads(manifest_path.read_text())
        if (
            manifest["version"] != 1
            or digest(bundle / "database.sql.gz.age") != manifest["database_cipher_sha256"]
        ):
            raise ValueError("backup integrity")
        # Validate all objects before changing storage/database.
        originals: list[tuple[str, Path]] = []
        for index, obj in enumerate(manifest["objects"]):
            source = (root / obj["path"]).resolve()
            if not source.is_relative_to(root.resolve()) or digest(source) != obj["cipher_sha256"]:
                raise ValueError("backup integrity")
            original = temp / str(index)
            decrypt(source, original, identity)
            if original.stat().st_size != obj["size"] or digest(original) != obj["sha256"]:
                raise ValueError("backup integrity")
            originals.append((obj["key"], original))
        zipped = temp / "database.sql.gz"
        decrypt(bundle / "database.sql.gz.age", zipped, identity)
        dump = temp / "database.sql"
        with gzip.open(zipped, "rb") as source, dump.open("wb") as output:
            while block := source.read(1024 * 1024):
                output.write(block)
        for key, original in originals:
            storage.restore_object(key, original)
        with dump.open("rb") as source:
            subprocess.run(  # noqa: S603 -- fixed executables, argument arrays, no shell
                [executable("psql"), "--single-transaction", "--set", "ON_ERROR_STOP=1"],
                env=environment(),
                stdin=source,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        dsn = (
            make_url(get_settings().database_url)
            .set(drivername="postgresql")
            .render_as_string(hide_password=False)
        )
        with psycopg.connect(dsn) as conn:
            conn.execute(
                "UPDATE attachments SET state='failed', upload_id=NULL "
                "WHERE state IN ('uploading','verifying')"
            )
            conn.execute(
                "UPDATE imaging_imports SET state='failed', upload_id=NULL, "
                "failure='restore_incomplete' WHERE state='uploading' OR NOT verified"
            )


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["backup", "restore"])
    parser.add_argument("--root", type=Path, default=Path("/backups/files"))
    parser.add_argument("--label", default="manual")
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--identity")
    args = parser.parse_args()
    if args.action == "backup":
        result = backup(
            args.root, os.environ.get("BACKUP_RECIPIENT", ""), args.label.replace("-", "")
        )
        print(result)  # noqa: T201
    elif args.bundle and args.identity:
        restore(args.root, args.bundle, args.identity)
    else:
        parser.error("restore requires --bundle and --identity")


if __name__ == "__main__":
    main()
