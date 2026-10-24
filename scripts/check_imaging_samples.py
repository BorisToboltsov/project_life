"""Explicit network compatibility check; no datasets are retained or logged."""

import hashlib
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from pydicom.pixels.utils import pixel_array

from app.imaging.extraction import extract_archive
from app.imaging.pixels import decode
from app.imaging.process import inspect_archive


def main() -> None:
    catalog = json.loads(Path(__file__).with_name("imaging_samples.json").read_text())
    base = "https://raw.githubusercontent.com/neurolabusc/dcm_qa_enh/"
    with tempfile.TemporaryDirectory(prefix="life-reference-") as directory:
        root = Path(directory)
        for index, expected in enumerate(catalog["samples"]):
            url = base + catalog["revision"] + "/" + expected["path"]
            with urllib.request.urlopen(url, timeout=90) as response:
                data = response.read(20 * 1024 * 1024 + 1)
            if hashlib.sha256(data).hexdigest() != expected["sha256"]:
                raise RuntimeError("reference_hash_mismatch")
            archive = root / "input.zip"
            with zipfile.ZipFile(archive, "w") as target:
                target.writestr("instance.dcm", data)
            result = inspect_archive(archive)
            actual = {
                "frames": sum(len(item.frames) for item in result.instances),
                "stacks": [
                    len(s.frames) for study in result.studies for s in study.stacks
                ],
                "warnings": [w for study in result.studies for w in study.warnings],
                "issues": len(result.issues),
            }
            if actual != {key: expected[key] for key in actual}:
                raise RuntimeError("reference_index_mismatch")
            destination = root / str(index)
            destination.mkdir()
            extract_archive(archive, destination, result.instances)
            for item in result.instances:
                if (destination / str(item.member)).read_bytes() != data:
                    raise RuntimeError("reference_bytes_mismatch")
                source = destination / str(item.member)
                reference = pixel_array(source, raw=True)
                for frame_index in sorted({0, len(item.frames) // 2, len(item.frames) - 1}):
                    target = root / "frame.bin"
                    decode(source, target, frame_index)
                    expected_pixels = reference[frame_index] if len(item.frames) > 1 else reference
                    dtype = np.dtype("<i2" if item.signed else "<u2")
                    if target.read_bytes() != expected_pixels.astype(dtype).tobytes():
                        raise RuntimeError("reference_pixels_mismatch")
                    if target.stat().st_size != item.rows * item.columns * 2:
                        raise RuntimeError("reference_frame_size_mismatch")
            # Verify geometric order independently for every indexed stack.
            for study in result.studies:
                for stack in study.stacks:
                    distances = []
                    for instance_index, frame_index in stack.frames:
                        frame = result.instances[instance_index].frames[frame_index]
                        if frame.orientation is None or frame.position is None:
                            raise RuntimeError("reference_geometry_missing")
                        a, b = frame.orientation[:3], frame.orientation[3:]
                        normal = (
                            a[1] * b[2] - a[2] * b[1],
                            a[2] * b[0] - a[0] * b[2],
                            a[0] * b[1] - a[1] * b[0],
                        )
                        distances.append(
                            sum(
                                x * y
                                for x, y in zip(normal, frame.position, strict=True)
                            )
                        )
                    if distances != sorted(distances):
                        raise RuntimeError("reference_order_mismatch")
            print(f"OK sample {index + 1}: {actual['frames']} frames")


if __name__ == "__main__":
    main()
