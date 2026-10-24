"""Resource-limited document parsing subprocess. No document details in diagnostics."""

import logging
import resource
import sys
import warnings
from pathlib import Path
from typing import BinaryIO

from PIL import Image
from pypdf import PdfReader

MAX_PIXELS = 25_000_000


def inspect_content(stream: BinaryIO) -> str:
    magic = stream.read(8)
    stream.seek(0)
    if magic.startswith(b"%PDF-"):
        reader = PdfReader(stream, strict=True)
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 500:
            raise ValueError("unsupported PDF")
        return "application/pdf"
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(stream) as image:
            if image.format not in {"JPEG", "PNG"}:
                raise ValueError("unsupported image")
            if image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                raise ValueError("image dimensions")
            mime = "image/jpeg" if image.format == "JPEG" else "image/png"
            image.verify()
            return mime


def main() -> None:
    logging.disable(logging.CRITICAL)
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    # Linux containers enforce virtual address space; macOS does not support this limit.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    try:
        with Path(sys.argv[1]).open("rb") as stream:
            result = inspect_content(stream)
    except Exception:
        sys.exit(1)
    print(result)  # noqa: T201


if __name__ == "__main__":
    main()
