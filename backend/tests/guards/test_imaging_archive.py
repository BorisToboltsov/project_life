"""Untrusted archives cannot write paths or silently change DICOM ordering."""

import hashlib
import io
import stat
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import UID, CTImageStorage, EnhancedMRImageStorage, ExplicitVRLittleEndian

from app.imaging.archive import ArchiveError, Limits, members
from app.imaging.dicom import inspect
from app.imaging.process import inspect_archive


def dicom(*, number: int = 1, z: float = 0, enhanced: bool = False) -> FileDataset:
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID = EnhancedMRImageStorage if enhanced else CTImageStorage
    meta.MediaStorageSOPInstanceUID = UID(f"1.2.826.1.{number}")
    ds = FileDataset(io.BytesIO(), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = "1.2.826.2"
    ds.SeriesInstanceUID = "1.2.826.3"
    ds.PatientName = "Synthetic^Patient"
    ds.Rows = 2
    ds.Columns = 2
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 1
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.ImagePositionPatient = [0, 0, z]
    ds.PixelSpacing = [0.5, 0.5]
    ds.InstanceNumber = number
    ds.RescaleIntercept = -1024
    ds.RescaleSlope = 1
    ds.PixelData = b"\0" * 8
    if enhanced:
        ds.NumberOfFrames = 2
        ds.PixelData = b"\0" * 16
        shared = Dataset()
        orientation = Dataset()
        orientation.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        shared.PlaneOrientationSequence = [orientation]
        ds.SharedFunctionalGroupsSequence = [shared]
        frames: list[Dataset] = []
        for height in (3, 1):
            group, position, transform = Dataset(), Dataset(), Dataset()
            position.ImagePositionPatient = [0, 0, height]
            group.PlanePositionSequence = [position]
            transform.RescaleSlope = height
            transform.RescaleIntercept = -100
            group.PixelValueTransformationSequence = [transform]
            frames.append(group)
        ds.PerFrameFunctionalGroupsSequence = frames
    return ds


def encoded(ds: FileDataset) -> bytes:
    stream = io.BytesIO()
    ds.save_as(stream, enforce_file_format=True)
    return stream.getvalue()


def archive(tmp_path: Path, entries: list[tuple[str | zipfile.ZipInfo, bytes]]) -> Path:
    target = tmp_path / "scan.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name, data in entries:
            output.writestr(name, data)
    return target


@pytest.mark.parametrize(
    "name", ["../outside", "/absolute", "dir/../../escape", "C:/drive", "a\\b", "bad\nname"]
)
def test_rejects_unsafe_paths(tmp_path: Path, name: str) -> None:
    with pytest.raises(ArchiveError, match="unsafe_path"):
        list(members(archive(tmp_path, [(name, b"x")])))
    assert not (tmp_path.parent / "outside").exists()


def test_rejects_symlink(tmp_path: Path) -> None:
    info = zipfile.ZipInfo("link")
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    with pytest.raises(ArchiveError, match="unsafe_path"):
        list(members(archive(tmp_path, [(info, b"/etc/passwd")])))


def test_rejects_duplicate_paths(tmp_path: Path) -> None:
    with pytest.raises(ArchiveError, match="duplicate_path"):
        list(members(archive(tmp_path, [("scan", b"x"), ("SCAN", b"y")])))


@pytest.mark.parametrize(
    "content",
    [
        b"PK\x03\x04",
        b"7z\xbc\xaf",
        b"Rar!",
        b"\x1f\x8b",
        b"BZh",
        b"\xfd7zXZ\x00",
        b"\0" * 257 + b"ustar",
    ],
)
def test_rejects_nested_archives_without_relying_on_extension(
    tmp_path: Path, content: bytes
) -> None:
    with pytest.raises(ArchiveError, match="nested_archive"):
        list(members(archive(tmp_path, [("image.dcm", content)])))


@pytest.mark.parametrize(
    ("limits", "code"),
    [
        (replace(Limits(), files=1), "file_limit"),
        (replace(Limits(), expanded=10), "expanded_limit"),
        (replace(Limits(), member=10), "expanded_limit"),
        (replace(Limits(), archive=10), "archive_limit"),
    ],
)
def test_bounds_archive(tmp_path: Path, limits: Limits, code: str) -> None:
    path = archive(tmp_path, [("a", b"x" * 20), ("b", b"y" * 20)])
    with pytest.raises(ArchiveError, match=code):
        list(members(path, limits))


def test_ct_sorted_by_position_not_filename_or_instance_number(tmp_path: Path) -> None:
    path = archive(
        tmp_path,
        [
            ("a", encoded(dicom(number=1, z=20))),
            ("b", encoded(dicom(number=2, z=10))),
            ("viewer.exe", b"MZprogram"),
        ],
    )
    result = inspect(path)
    assert result.studies[0].stacks[0].frames == [(1, 0), (0, 0)]
    assert result.studies[0].stacks[0].ordering == "geometry"
    assert result.issues[0].code == "not_dicom"
    assert result.instances[0].signed
    assert result.instances[0].bits_stored == 12
    assert result.instances[0].frames[0].intercept == -1024


def test_enhanced_frames_have_own_geometry_and_rescale(tmp_path: Path) -> None:
    result = inspect(archive(tmp_path, [("mr", encoded(dicom(enhanced=True)))]))
    assert result.studies[0].stacks[0].frames == [(0, 1), (0, 0)]
    assert [f.slope for f in result.instances[0].frames] == [3, 1]
    assert result.studies[0].modalities == ["MR"]


def test_temporal_phases_and_orientation_are_separate(tmp_path: Path) -> None:
    first, second, third = dicom(), dicom(number=2), dicom(number=3)
    second.TemporalPositionIdentifier = 2
    third.ImageOrientationPatient = [0, 1, 0, 0, 0, 1]
    result = inspect(
        archive(tmp_path, [(str(i), encoded(d)) for i, d in enumerate((first, second, third))])
    )
    assert len(result.studies[0].stacks) == 3


def test_missing_geometry_has_explicit_fallback_warning(tmp_path: Path) -> None:
    ds = dicom()
    del ds.ImagePositionPatient
    result = inspect(archive(tmp_path, [("ct", encoded(ds))]))
    assert result.studies[0].warnings == ["fallback_order"]
    assert result.studies[0].stacks[0].ordering == "instance_number"


def test_same_uid_conflicting_bytes_rejected(tmp_path: Path) -> None:
    with pytest.raises(ArchiveError, match="conflicting_instance"):
        inspect(archive(tmp_path, [("a", encoded(dicom(z=1))), ("b", encoded(dicom(z=2)))]))


def test_same_uid_same_bytes_reported_as_duplicate(tmp_path: Path) -> None:
    data = encoded(dicom())
    result = inspect(archive(tmp_path, [("a", data), ("b", data)]))
    assert len(result.instances) == 1
    assert result.issues[0].code == "duplicate"


def test_frame_count_bounded_across_instances(tmp_path: Path) -> None:
    with pytest.raises(ArchiveError, match="frame_limit"):
        inspect(
            archive(tmp_path, [("a", encoded(dicom())), ("b", encoded(dicom(number=2)))]),
            replace(Limits(), frames=1),
        )


def test_corrupt_dicom_is_reported_before_confirmation(tmp_path: Path) -> None:
    broken = dicom(number=2)
    broken.BitsStored = 17
    result = inspect(archive(tmp_path, [("valid", encoded(dicom())), ("broken", encoded(broken))]))
    assert len(result.instances) == 1
    assert result.issues[0].code == "invalid_dicom"


def test_archive_with_no_supported_studies_rejected(tmp_path: Path) -> None:
    with pytest.raises(ArchiveError, match="no_studies"):
        inspect(archive(tmp_path, [("readme", b"hello")]))


def test_child_process_returns_index_without_diagnostics(tmp_path: Path) -> None:
    from app.imaging.process import inspect_archive

    result = inspect_archive(archive(tmp_path, [("ct", encoded(dicom()))]))
    assert result.studies[0].modalities == ["CT"]


def test_child_process_returns_only_canonical_failure(tmp_path: Path) -> None:
    from app.imaging.process import inspect_archive

    with pytest.raises(ArchiveError, match=r"^unsafe_path$"):
        inspect_archive(archive(tmp_path, [("../patient-name", b"x")]))


def test_invalid_child_manifest_does_not_expose_parser_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import subprocess
    from typing import Any

    from app.imaging import process

    def broken_child(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        kwargs["stdout"].write(b'{"instances":[{"patient":"private patient"}]}')
        return subprocess.CompletedProcess(args[0], 0)

    monkeypatch.setattr(process.subprocess, "run", broken_child)
    with pytest.raises(ArchiveError, match=r"^inspection_failed$"):
        process.inspect_archive(tmp_path / "unused.zip")


def test_reference_ct_sample_keeps_geometry_and_bytes(tmp_path: Path) -> None:
    import pydicom

    sample = Path(pydicom.__file__).parent / "data" / "test_files" / "CT_small.dcm"
    data = sample.read_bytes()
    result = inspect_archive(archive(tmp_path, [("ct.dcm", data)]))
    assert len(result.instances) == 1
    assert result.instances[0].rows == 128
    assert result.instances[0].columns == 128
    assert result.instances[0].frames[0].position is not None
    assert result.instances[0].sha256 == hashlib.sha256(data).hexdigest()


def test_enhanced_without_functional_groups_is_not_given_invented_geometry(tmp_path: Path) -> None:
    dataset = dicom(enhanced=True)
    del dataset.PerFrameFunctionalGroupsSequence
    with pytest.raises(ArchiveError, match="no_studies"):
        inspect_archive(archive(tmp_path, [("incomplete-enhanced.dcm", encoded(dataset))]))


@pytest.mark.parametrize("pointer", [0x00180086, 0x20051011])
def test_enhanced_dimensions_separate_echoes_and_components(tmp_path: Path, pointer: int) -> None:
    from copy import deepcopy

    ds = dicom(enhanced=True)
    spatial, contrast = Dataset(), Dataset()
    spatial.DimensionIndexPointer = 0x00209057
    contrast.DimensionIndexPointer = pointer
    ds.DimensionIndexSequence = [spatial, contrast]
    groups = list(ds.PerFrameFunctionalGroupsSequence)
    ds.PerFrameFunctionalGroupsSequence = groups + deepcopy(groups)
    ds.NumberOfFrames = 4
    ds.PixelData = b"\0" * 32
    for index, group in enumerate(ds.PerFrameFunctionalGroupsSequence):
        content = Dataset()
        content.DimensionIndexValues = [index % 2 + 1, index // 2]
        group.FrameContentSequence = [content]
    result = inspect_archive(archive(tmp_path, [("enhanced", encoded(ds))]))
    assert [stack.frames for stack in result.studies[0].stacks] == [
        [(0, 1), (0, 0)],
        [(0, 3), (0, 2)],
    ]
    assert result.studies[0].warnings == []


def test_incomplete_dimension_values_are_rejected(tmp_path: Path) -> None:
    ds = dicom(enhanced=True)
    dimension = Dataset()
    dimension.DimensionIndexPointer = 0x00180086
    ds.DimensionIndexSequence = [dimension]
    with pytest.raises(ArchiveError, match="no_studies"):
        inspect_archive(archive(tmp_path, [("enhanced", encoded(ds))]))
