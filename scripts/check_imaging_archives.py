"""Explicit network/container gate: full public archives and real SIGKILL recovery.

Uses only the disposable life-e2e Compose project. Run after make stand, without
concurrent browser tests. Sources are pinned and discarded unless --cache is given.
"""

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from uuid import uuid7

import httpx

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = [
    "docker",
    "compose",
    "-p",
    "life-e2e",
    "-f",
    str(ROOT / "deploy/compose.yaml"),
    "-f",
    str(ROOT / "deploy/compose.build.yaml"),
    "--env-file",
    str(ROOT / "deploy/e2e.env"),
]
# Pause at a deterministic real storage boundary; no production hooks or fake queue.
PAUSE = """
import os, signal, runpy
from pathlib import Path
from app.services.file_storage import FileStorage
original = FileStorage.restore_object
marker = Path('/scratch/recovery-paused')
def write(self, key, source):
    original(self, key, source)
    if not marker.exists():
        marker.touch()
        os.kill(os.getpid(), signal.SIGSTOP)
FileStorage.restore_object = write
runpy.run_module('app.imaging.queue', run_name='__main__')
"""


def compose(*args, extra=(), input=None):
    result = subprocess.run(
        COMPOSE + list(extra) + list(args),
        cwd=ROOT,
        input=input,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode:
        # Avoid leaking presigned URLs, tokens or DICOM fields via diagnostics.
        raise RuntimeError(f"container command failed: {args[0]}")
    return result.stdout.strip()


def inside(mode, expected=None):
    return compose(
        "exec",
        "-T",
        "backend",
        "python",
        "/tmp/life-imaging-check.py",
        mode,
        input=json.dumps(expected) if expected else None,
    )


def wait_for(check, timeout=240):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if result := check():
            return result
        time.sleep(1)
    raise RuntimeError("imaging gate timed out")


def download(sample, directory):
    path = directory / (sample["name"] + ".zip")
    if not path.exists():
        url = f"https://codeload.github.com/neurolabusc/{sample['name']}/zip/{sample['revision']}"
        with (
            urllib.request.urlopen(url, timeout=60) as source,
            path.open("wb") as output,
        ):
            total = 0
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > 512 * 1024**2:
                    raise RuntimeError("reference archive too large")
                output.write(chunk)
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != sample["sha256"]:
        raise RuntimeError("reference hash mismatch")
    return path


def run(sample, path, override, interrupt):
    token = json.loads(inside("auth"))["token"]
    with httpx.Client(
        base_url="http://localhost:8080",
        timeout=120,
        headers={"Authorization": f"Bearer {token}"},
    ) as client:

        def api(method, route, body=None):
            response = client.request(method, "/api" + route, json=body)
            if response.is_error:
                raise RuntimeError(f"API status {response.status_code}")
            return response.json()

        study, import_id = str(uuid7()), str(uuid7())
        route = f"/imaging-imports/{import_id}"
        api(
            "PUT",
            f"/studies/{study}",
            {"title": "Reference archive", "local_date": "2026-10-23"},
        )
        api(
            "PUT",
            f"/studies/{study}/imports/{import_id}",
            {
                "name": "reference.zip",
                "size": path.stat().st_size,
                "sha256": sample["sha256"],
            },
        )
        plan = api("POST", route + "/parts")
        with (
            path.open("rb") as stream,
            httpx.Client(base_url="http://localhost:8080", timeout=120) as upload,
        ):
            for url in plan["urls"]:
                response = upload.put(url, content=stream.read(plan["part_size"]))
                if response.is_error:
                    raise RuntimeError(f"upload status {response.status_code}")
        api("POST", route + "/complete")

        def state(expected):
            result = api("GET", route)
            if result["state"] == "failed":
                raise RuntimeError("reference import failed")
            return result if result["state"] == expected else None

        inspected = wait_for(lambda: state("awaiting_confirmation"))
        assert len(inspected["candidates"]) == sample["studies"]
        assert sum(c["frames"] for c in inspected["candidates"]) == sample["frames"]
        if interrupt:
            compose(
                "up",
                "-d",
                "--no-deps",
                "--force-recreate",
                "imaging-worker",
                extra=("-f", str(override)),
            )
        selection = {
            c["uid"]: study if i == 0 else str(uuid7())
            for i, c in enumerate(inspected["candidates"])
        }
        api("POST", route + "/confirm", {"studies": selection})
        expected = {**sample, "id": import_id}
        if interrupt:

            def paused():
                return (
                    compose(
                        "exec",
                        "-T",
                        "imaging-worker",
                        "python",
                        "-c",
                        "from pathlib import Path; print(int(Path('/scratch/recovery-paused').exists()))",
                    )
                    == "1"
                )

            wait_for(paused)
            inside("partial", expected)
            compose("kill", "-s", "SIGKILL", "imaging-worker")
            inside("partial", expected)
            compose("start", "imaging-worker")
            print(
                "SIGKILL: partial object retained, index rolled back; waiting for heartbeat recovery",
                flush=True,
            )
        wait_for(lambda: state("ready"), timeout=300)
        assert (
            api("POST", route + "/confirm", {"studies": selection})["state"] == "ready"
        )
        inside("verify", expected)
        assert len(api("GET", "/studies")) == sample["studies"]
        if interrupt:
            remaining = compose(
                "exec",
                "-T",
                "imaging-worker",
                "python",
                "-c",
                "from pathlib import Path; print(len(list(Path('/scratch').glob('life-original-*'))))",
            )
            assert remaining == "0", "scratch was not cleaned"
            compose("up", "-d", "--no-deps", "--force-recreate", "imaging-worker")
        print(
            f"OK {sample['name']}: {sample['instances']} instances, {sample['frames']} frames, {sample['studies']} studies",
            flush=True,
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    catalog = json.loads(Path(__file__).with_name("imaging_archives.json").read_text())
    compose(
        "cp", str(ROOT / "deploy/test/imaging.py"), "backend:/tmp/life-imaging-check.py"
    )
    with tempfile.TemporaryDirectory(prefix="life-reference-") as temporary:
        directory = args.cache or Path(temporary)
        directory.mkdir(parents=True, exist_ok=True)
        override = Path(temporary) / "pause.json"
        override.write_text(
            json.dumps(
                {"services": {"imaging-worker": {"command": ["python", "-c", PAUSE]}}}
            )
        )
        try:
            for sample in catalog:
                run(
                    sample,
                    download(sample, directory),
                    override,
                    sample["name"] == "dcm_qa_ct",
                )
        finally:
            compose("up", "-d", "--no-deps", "--force-recreate", "imaging-worker")


if __name__ == "__main__":
    main()
