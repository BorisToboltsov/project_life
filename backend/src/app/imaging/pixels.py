"""Bounded, isolated decoding of one immutable instance frame. No diagnostic data."""

import hashlib
import logging
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import threading
import warnings
from collections import OrderedDict
from pathlib import Path

from app.services.file_storage import FileStorage

MAX_PIXELS = 2048 * 2048
CACHE_BYTES = 32 * 1024**2
_slots = threading.BoundedSemaphore(2)
_lock = threading.Lock()
_cache: OrderedDict[tuple[str, str, int], bytes] = OrderedDict()


class PixelError(ValueError):
    """Stable error without source paths or DICOM fields."""


class PixelBusy(PixelError):
    pass


def decoded_frame(storage: FileStorage, key: str, size: int, sha: str, frame: int) -> bytes:
    identity = (key, sha, frame)
    with _lock:
        cached = _cache.get(identity)
        if cached is not None:
            _cache.move_to_end(identity)
            return cached
    if not _slots.acquire(blocking=False):
        raise PixelBusy("decoder_busy")
    try:
        with tempfile.TemporaryDirectory(prefix="life-frame-") as directory:
            if shutil.disk_usage(directory).free < size + MAX_PIXELS * 2:
                raise PixelBusy("scratch_full")
            source, target = Path(directory) / "instance", Path(directory) / "frame"
            actual, digest = 0, hashlib.sha256()
            with source.open("wb") as stream:
                for chunk in storage.chunks(key):
                    actual += len(chunk)
                    if actual > size:
                        raise PixelError("integrity_failed")
                    digest.update(chunk)
                    stream.write(chunk)
            if actual != size or digest.hexdigest() != sha:
                raise PixelError("integrity_failed")
            try:
                result = subprocess.run(  # noqa: S603 -- fixed module and interpreter
                    [
                        sys.executable,
                        "-m",
                        "app.imaging.pixels",
                        str(source),
                        str(target),
                        str(frame),
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                    check=False,
                    env={**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"},
                )
            except subprocess.TimeoutExpired:
                raise PixelBusy("decode_timeout") from None
            if (
                result.returncode != 0
                or not target.exists()
                or target.stat().st_size > MAX_PIXELS * 2
            ):
                raise PixelError("unsupported_pixels")
            data = target.read_bytes()
        with _lock:
            _cache[identity] = data
            while sum(map(len, _cache.values())) > CACHE_BYTES:
                _cache.popitem(last=False)
        return data
    finally:
        _slots.release()


def decode(source: Path, target: Path, index: int) -> None:
    import numpy as np
    from pydicom.filereader import dcmread  # pyright: ignore[reportUnknownVariableType]
    from pydicom.pixels.utils import pixel_array

    from app.imaging.dicom import functional, sequence

    ds = dcmread(source, stop_before_pixels=True)
    rows, columns = int(ds.Rows), int(ds.Columns)
    if not 0 <= index < int(getattr(ds, "NumberOfFrames", 1)):
        raise PixelError("invalid_frame")
    if not 0 < rows * columns <= MAX_PIXELS or int(ds.SamplesPerPixel) != 1:
        raise PixelError("pixel_limit")
    if str(ds.PhotometricInterpretation) not in {"MONOCHROME1", "MONOCHROME2"}:
        raise PixelError("unsupported_pixels")
    if int(ds.BitsAllocated) not in (8, 16) or int(ds.PixelRepresentation) not in (0, 1):
        raise PixelError("unsupported_pixels")
    # The indexed contract supports linear rescale and windowing only. Never silently
    # replace a vendor LUT or sigmoid with a different presentation transform.
    per = getattr(ds, "PerFrameFunctionalGroupsSequence", None)
    shared = sequence(ds, "SharedFunctionalGroupsSequence")
    from pydicom.dataset import Dataset

    group = per[index] if per else Dataset()
    voi = functional(group, shared, ds, "FrameVOILUTSequence")
    transform = functional(group, shared, ds, "PixelValueTransformationSequence")
    if (
        "PresentationLUTSequence" in ds
        or str(getattr(ds, "PresentationLUTShape", ""))
        not in {"", "INVERSE" if str(ds.PhotometricInterpretation) == "MONOCHROME1" else "IDENTITY"}
        or "ModalityLUTSequence" in ds
        or "ModalityLUTSequence" in transform
        or "VOILUTSequence" in ds
        or "VOILUTSequence" in voi
        or str(getattr(voi, "VOILUTFunction", "LINEAR")) != "LINEAR"
    ):
        raise PixelError("unsupported_lut")
    array = pixel_array(source, index=index, raw=True)
    if array.shape != (rows, columns):
        raise PixelError("invalid_shape")
    # Normalize transport byte order/width, preserving signed stored pixel values.
    dtype = np.dtype("<i2" if int(ds.PixelRepresentation) else "<u2")
    target.write_bytes(array.astype(dtype, copy=False).tobytes())


def main() -> None:
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PIXELS * 2, MAX_PIXELS * 2))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    try:
        decode(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]))
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
