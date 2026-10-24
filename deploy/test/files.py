"""Synthetic attachment for the isolated deployment/restore test."""

import base64
import json
import hashlib
import io
import sys
import tempfile
from pathlib import Path
from uuid import uuid7

import psycopg
from PIL import Image
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.imaging.archive import members
from app.imaging.dicom import inspect
from app.imaging.pixels import decoded_frame
from app.services.file_storage import file_storage

stream = io.BytesIO()
Image.new("RGB", (2, 2), "red").save(stream, format="PNG")
data = stream.getvalue()
storage = file_storage()
dsn = (
    make_url(get_settings().database_url)
    .set(drivername="postgresql")
    .render_as_string(hide_password=False)
)
with psycopg.connect(dsn) as conn:
    if sys.argv[1] == "seed":
        user = conn.execute("SELECT id FROM users LIMIT 1").fetchone()[0]
        report, attachment, key = uuid7(), uuid7(), str(uuid7())
        conn.execute(
            "INSERT INTO lab_reports(id,user_id,local_date) VALUES (%s,%s,CURRENT_DATE)",
            [report, user],
        )
        conn.execute(
            "INSERT INTO attachments(id,user_id,report_id,name,size,sha256,state,content_type,object_key,expires_at) VALUES (%s,%s,%s,'restore-test.png',%s,%s,'ready','image/png',%s,now()+interval '24 hours')",
            [
                attachment,
                user,
                report,
                len(data),
                hashlib.sha256(data).hexdigest(),
                key,
            ],
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            path.write_bytes(data)
            storage.restore_object(key, path)
    else:
        row = conn.execute(
            "SELECT object_key,sha256 FROM attachments WHERE name='restore-test.png'"
        ).fetchone()
        assert row is not None
        if sys.argv[1] == "remove-test-object":
            storage.delete(row[0])
        else:
            actual = b"".join(storage.chunks(row[0]))
            assert actual == data and hashlib.sha256(actual).hexdigest() == row[1]
            print("restored_file_verified")

# Synthetic CT/Enhanced MR, also used by the browser smoke. Verify every original and instance.
archive_data = base64.b64decode(
    "UEsDBBQAAAAIABe8Vl21ob68IgEAAHYCAAAGAAAAY3QuZGNtxVDBSsNAEJ1scwg2lrWVUsTDHntx2WySGq+mQgOmG7oUEUQQKdhLT7l48j/8Oj/Ft2uNqAePzjLMzHtvZoch+l+bV2XNENfXIb0iMgrIXLoICxjiujqhRGpZZEomSqlC5jKRGRwo+B4U8YdCzxwKjAM7/tHlKscNwZ12erAynRVKZaksZHZReM2I7GJAzS22M7VIodIiovEfu0Q0+bULx2uWQ7LPu/Zp024f75uHdrvZtULQIdQHnVqToME3JAUyosoySqDWNLcxKanu9g7sHNgE+g7zvq/F1F3PuotOKaQS3bVZmnKxMvWVBss9y8AedZnCxAi/5JiQQ0OBYziYwGcxMuazPrJe8Dl/xV3fWaJ05n+2qEO3mXh74WRuCNf5sndQSwMEFAAAAAgAF7xWXRYJKhl7AQAAmgMAAAYAAABtci5kY23Fkc9Kw0AQxidpkaC1xLaUIj0snurBZfOnNQVPpoUWTFMTqggiiBTspadcPPkMevZRfJg+ifrtmFa0oPTkhu3MfvObyZct0f+u3jCMTMTJWZFeEE0yKD7VEcswESfDJjnSlYGvpKOUCmRbOtLH5l8QBTClT8btaB2aDa32o0+fdK3yNRM8qtLrBEr5ngyk3w2YqVI6KNP4Cv7iSHigXGFR/U83FjXW3Nh4xqMKpQ/z7H6aze5uxrfZbDrPhKBd0BbTnux2BZVx3l51eyTgZJia5IB1qZeWSEl1nW9ox9Aa4Fca7/wsWvr+Un2nLSpSiO4oHsXhIImjvouqxbN1ZjNngttbZQqzLbyvjVltMGToio2KwVkJmcnZDrKCsXxTYuu+I0e5PntIcS5qj4KSw+f0nOgEf+7bOy18REH1J621ck2w9vt3UaJ4zmvec8E9VZ7TzLUaa9/vzGM/feYOcm6fKPe8pT0DWzrW9CbTnY2ma3rxaFN8SbjT9fUBUEsBAhQDFAAAAAgAF7xWXbWhvrwiAQAAdgIAAAYAAAAAAAAAAAAAAIABAAAAAGN0LmRjbVBLAQIUAxQAAAAIABe8Vl0WCSoZewEAAJoDAAAGAAAAAAAAAAAAAACAAUYBAABtci5kY21QSwUGAAAAAAIAAgBoAAAA5QIAAAAA"
)
with tempfile.TemporaryDirectory() as directory, psycopg.connect(dsn) as conn:
    path = Path(directory) / "study.zip"
    path.write_bytes(archive_data)
    if sys.argv[1] == "seed":
        manifest = inspect(path)
        user = conn.execute("SELECT id FROM users LIMIT 1").fetchone()[0]
        import_id, original_key = uuid7(), str(uuid7())
        studies = {item.uid: uuid7() for item in manifest.studies}
        for study in studies.values():
            conn.execute(
                "INSERT INTO health_studies(id,user_id,title,local_date) VALUES (%s,%s,'restore-study',CURRENT_DATE)",
                [study, user],
            )
        anchor = next(iter(studies.values()))
        conn.execute(
            "INSERT INTO imaging_imports(id,user_id,anchor_id,name,size,sha256,object_key,state,reserved_bytes,verified,manifest,selection,expires_at) VALUES (%s,%s,%s,'restore-study.zip',%s,%s,%s,'ready',%s,true,%s,%s,now()+interval '24 hours')",
            [
                import_id,
                user,
                anchor,
                len(archive_data),
                hashlib.sha256(archive_data).hexdigest(),
                original_key,
                len(archive_data) + sum(i.size for i in manifest.instances),
                json.dumps(manifest.model_dump()),
                json.dumps({uid: str(study) for uid, study in studies.items()}),
            ],
        )
        storage.restore_object(original_key, path)
        for uid, study in studies.items():
            conn.execute(
                "INSERT INTO study_imaging(study_id,user_id,import_id,dicom_uid) VALUES (%s,%s,%s,%s)",
                [study, user, import_id, uid],
            )
        for member in members(path):
            key = str(uuid7())
            exported = Path(directory) / str(member.number)
            exported.write_bytes(member.stream.read())
            storage.restore_object(key, exported)
            conn.execute(
                "INSERT INTO imaging_objects(object_key,import_id,member,size,sha256) VALUES (%s,%s,%s,%s,%s)",
                [key, import_id, member.number, member.size, member.sha256],
            )
    else:
        rows = conn.execute(
            "SELECT object_key,sha256,size FROM imaging_imports WHERE name='restore-study.zip' UNION ALL SELECT o.object_key,o.sha256,o.size FROM imaging_objects o JOIN imaging_imports i ON i.id=o.import_id WHERE i.name='restore-study.zip'"
        ).fetchall()
        assert len(rows) == 3
        for key, sha, size in rows:
            if sys.argv[1] == "remove-test-object":
                storage.delete(key)
            else:
                actual = b"".join(storage.chunks(key))
                assert len(actual) == size and hashlib.sha256(actual).hexdigest() == sha
        if sys.argv[1] != "remove-test-object":
            for key, sha, size in rows:
                if key != conn.execute("SELECT object_key FROM imaging_imports WHERE name='restore-study.zip'").fetchone()[0]:
                    assert decoded_frame(storage, key, size, sha, 0) == b"\0" * 8
            print("restored_imaging_pixels_verified")
