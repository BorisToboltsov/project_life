"""Container-side assertions for the isolated imaging compatibility gate."""

import hashlib
import json
import sys
import tempfile
from pathlib import Path

import httpx
import numpy as np
from pydicom.pixels.utils import pixel_array
from collections import Counter
from uuid import UUID, uuid5, uuid7

import psycopg
from app.config import get_settings
from app.security.tokens import create_access_token
from app.services.file_storage import file_storage
from sqlalchemy.engine import make_url


def main():
    mode = sys.argv[1]
    dsn = make_url(get_settings().database_url).set(drivername="postgresql")
    with psycopg.connect(dsn.render_as_string(hide_password=False)) as conn:
        if mode == "auth":
            user = uuid7()
            conn.execute(
                "INSERT INTO users(id,email,password_hash,display_name,role,language,timezone,"
                "unit_system,disclaimer_accepted_at) VALUES (%s,%s,'disabled','Reference gate',"
                "'user','en','UTC','metric',now())",
                [user, f"reference-{user}@example.com"],
            )
            token, _ = create_access_token(user)
            print(json.dumps({"token": token}))
            return
        expected = json.load(sys.stdin)
        import_id = UUID(expected["id"])
        row = conn.execute(
            "SELECT state,manifest,object_key,sha256,size,reserved_bytes FROM imaging_imports "
            "WHERE id=%s",
            [import_id],
        ).fetchone()
        assert row is not None
        state, manifest, original, digest, size, reserved = row
        objects = conn.execute(
            "SELECT member,object_key,sha256,size FROM imaging_objects WHERE import_id=%s",
            [import_id],
        ).fetchall()
        storage = file_storage()
        if mode == "partial":
            assert state == "importing" and not objects, "partial index published"
            first = manifest["instances"][0]
            key = str(uuid5(import_id, str(first["member"])))
            actual = hashlib.sha256()
            for chunk in storage.chunks(key):
                actual.update(chunk)
            assert actual.hexdigest() == first["sha256"], "no partial object written"
            print("partial_object_present_index_unpublished")
            return
        assert state == "ready"
        assert len(objects) == expected["instances"]
        assert len(manifest["studies"]) == expected["studies"]
        assert (
            sum(len(i["frames"]) for i in manifest["instances"]) == expected["frames"]
        )
        assert len(manifest["issues"]) == expected["issues"]
        assert (
            dict(Counter(i["code"] for i in manifest["issues"]))
            == expected["issue_codes"]
        )
        assert sum(len(s["stacks"]) for s in manifest["studies"]) == expected["stacks"]
        assert reserved == size + sum(obj[3] for obj in objects)
        indexed = {i["member"]: i for i in manifest["instances"]}
        for member, key, sha, length in objects:
            assert key == str(uuid5(import_id, str(member)))
            assert (sha, length) == (indexed[member]["sha256"], indexed[member]["size"])
        for key, sha, length in [(original, digest, size)] + [o[1:] for o in objects]:
            actual, count = hashlib.sha256(), 0
            for chunk in storage.chunks(key):
                actual.update(chunk)
                count += len(chunk)
            assert (actual.hexdigest(), count) == (sha, length), "stored bytes changed"
        assert digest == expected["sha256"], "original archive changed"
        for study in manifest["studies"]:
            for stack in study["stacks"]:
                assert stack["ordering"] == "geometry"
                distances = []
                for instance, number in stack["frames"]:
                    frame = manifest["instances"][instance]["frames"][number]
                    a, b = frame["orientation"][:3], frame["orientation"][3:]
                    normal = (
                        a[1] * b[2] - a[2] * b[1],
                        a[2] * b[0] - a[0] * b[2],
                        a[0] * b[1] - a[1] * b[0],
                    )
                    distances.append(
                        sum(
                            x * y
                            for x, y in zip(normal, frame["position"], strict=True)
                        )
                    )
                assert distances == sorted(distances), "slice order changed"
        links = conn.execute(
            "SELECT count(*) FROM study_imaging WHERE import_id=%s", [import_id]
        ).fetchone()[0]
        assert links == expected["studies"]
        owner = conn.execute(
            "SELECT user_id FROM imaging_imports WHERE id=%s", [import_id]
        ).fetchone()[0]
        token, _ = create_access_token(owner)
        chosen = dict(
            conn.execute(
                "SELECT dicom_uid,study_id FROM study_imaging WHERE import_id=%s",
                [import_id],
            ).fetchall()
        )
        object_index = {
            member: (key, sha, length) for member, key, sha, length in objects
        }
        checked = 0
        with (
            httpx.Client(
                base_url="http://localhost:8000/api",
                headers={"Authorization": f"Bearer {token}"},
                timeout=60,
            ) as client,
            tempfile.TemporaryDirectory() as directory,
        ):
            source = Path(directory) / "instance"
            for study in manifest["studies"]:
                route = f"/studies/{chosen[study['uid']]}/viewer"
                listed = client.get(route)
                assert listed.status_code == 200
                assert len(listed.json()["series"]) == len(study["stacks"])
                for series in sorted({0, len(study["stacks"]) - 1}):
                    frames = study["stacks"][series]["frames"]
                    for number in sorted({0, len(frames) // 2, len(frames) - 1}):
                        instance_index, frame_index = frames[number]
                        instance = manifest["instances"][instance_index]
                        key, _, _ = object_index[instance["member"]]
                        with source.open("wb") as output:
                            for chunk in storage.chunks(key):
                                output.write(chunk)
                        reference = (
                            pixel_array(source, index=frame_index, raw=True)
                            .astype(np.dtype("<i2" if instance["signed"] else "<u2"))
                            .tobytes()
                        )
                        response = client.get(f"{route}/{series}/{number}/pixels")
                        assert response.status_code == 200, "frame endpoint failed"
                        assert response.content == reference, "pixel bytes changed"
                        assert (
                            len(response.content)
                            == instance["rows"] * instance["columns"] * 2
                        )
                        meta = client.get(f"{route}/{series}/{number}").json()
                        assert meta["frame"] == instance["frames"][frame_index]
                        assert response.headers["cache-control"] == "private, no-store"
                        checked += 1
        print(f"original_instances_geometry_quota_and_{checked}_frames_verified")


if __name__ == "__main__":
    main()
