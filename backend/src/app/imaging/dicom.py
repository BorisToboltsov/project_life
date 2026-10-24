"""Metadata-only CT/MR index. No pixel decode and no network access."""

import math
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, Field
from pydicom.dataset import Dataset
from pydicom.errors import InvalidDicomError
from pydicom.filereader import dcmread  # pyright: ignore[reportUnknownVariableType]
from pydicom.multival import MultiValue
from pydicom.uid import UID

from app.imaging.archive import DEFAULT_LIMITS, ArchiveError, Limits, Member, members

# Classic and Enhanced CT/MR. Other SOP classes remain visible as skipped files.
SOP_CLASSES: dict[str, Literal["CT", "MR"]] = {
    "1.2.840.10008.5.1.4.1.1.2": "CT",
    "1.2.840.10008.5.1.4.1.1.2.1": "CT",
    "1.2.840.10008.5.1.4.1.1.4": "MR",
    "1.2.840.10008.5.1.4.1.1.4.1": "MR",
}


class Frame(BaseModel):
    number: int
    position: list[float] | None
    orientation: list[float] | None
    spacing: list[float] | None
    dimensions: list[str] = Field(default_factory=list[str])
    temporal: str
    stack: str
    slope: float
    intercept: float
    window_center: list[float] | None
    window_width: list[float] | None


class Instance(BaseModel):
    member: int
    sha256: str
    size: int
    uid: str
    study_uid: str
    series_uid: str
    patient: str
    description: str
    series_description: str
    modality: Literal["CT", "MR"]
    transfer_syntax: str
    rows: int
    columns: int
    bits_allocated: int
    bits_stored: int
    high_bit: int
    signed: bool
    photometric: str
    instance_number: int
    frames: list[Frame]


class Issue(BaseModel):
    member: int
    name: str
    code: Literal["not_dicom", "unsupported_sop", "invalid_dicom", "duplicate"]


class Stack(BaseModel):
    series_uid: str
    description: str
    ordering: Literal["geometry", "instance_number"]
    # [index of instance in manifest, zero-based frame number]
    frames: list[tuple[int, int]]


class Study(BaseModel):
    uid: str
    description: str
    patients: list[str]
    modalities: list[str]
    stacks: list[Stack]
    warnings: list[str]


class Manifest(BaseModel):
    version: Literal[1] = 1
    instances: list[Instance] = Field(default_factory=list[Instance])
    studies: list[Study] = Field(default_factory=list[Study])
    issues: list[Issue] = Field(default_factory=list[Issue])
    expanded_bytes: int = 0


def text(ds: Dataset, key: str, maximum: int = 200) -> str:
    return str(getattr(ds, key, ""))[:maximum]


def uid(ds: Dataset, key: str) -> str:
    value = text(ds, key, 65)
    if not UID(value).is_valid:
        raise ValueError("invalid_uid")
    return value


def numbers(ds: Dataset, key: str, length: int | None = None) -> list[float] | None:
    raw = getattr(ds, key, None)
    if raw is None:
        return None
    values = (
        [float(v) for v in cast(list[float], raw)]
        if isinstance(raw, (list, MultiValue))
        else [float(raw)]
    )
    if not values or (length is not None and len(values) != length):
        raise ValueError("invalid_geometry")
    if not all(math.isfinite(v) for v in values):
        raise ValueError("invalid_number")
    return values


def sequence(ds: Dataset, key: str) -> Dataset:
    value = getattr(ds, key, None)
    if value is None:
        return Dataset()
    if len(value) != 1 or not isinstance(value[0], Dataset):
        raise ValueError("invalid_functional_group")
    return value[0]


def functional(per: Dataset, shared: Dataset, root: Dataset, key: str) -> Dataset:
    if key in per:
        return sequence(per, key)
    if key in shared:
        return sequence(shared, key)
    return root


def dimensions(root: Dataset, content: Dataset) -> list[str]:
    definitions = getattr(root, "DimensionIndexSequence", None)
    if definitions is None:
        return []
    values = numbers(content, "DimensionIndexValues")
    if values is None or len(values) != len(definitions):
        raise ValueError("invalid_dimensions")
    result: list[str] = []
    for definition, value in zip(definitions, values, strict=True):
        pointer = int(definition.DimensionIndexPointer)
        if value < 0 or not value.is_integer():
            raise ValueError("invalid_dimensions")
        # Spatial indices are ordered by patient geometry within each stack.
        if pointer in (0x00209057, 0x00200032):
            continue
        group = int(getattr(definition, "FunctionalGroupPointer", 0))
        creator = text(definition, "DimensionIndexPrivateCreator")
        result.append(f"{group}:{pointer}:{creator}:{int(value)}")
    return result


def frame(ds: Dataset, per: Dataset, shared: Dataset, number: int) -> Frame:
    position = numbers(
        functional(per, shared, ds, "PlanePositionSequence"), "ImagePositionPatient", 3
    )
    orientation = numbers(
        functional(per, shared, ds, "PlaneOrientationSequence"), "ImageOrientationPatient", 6
    )
    if orientation is not None:
        a, b = orientation[:3], orientation[3:]
        if (
            any(abs(sum(v * v for v in vector) - 1) > 0.01 for vector in (a, b))
            or abs(sum(x * y for x, y in zip(a, b, strict=True))) > 0.01
        ):
            raise ValueError("invalid_orientation")
    measures = functional(per, shared, ds, "PixelMeasuresSequence")
    spacing = numbers(measures, "PixelSpacing", 2)
    if spacing is not None and min(spacing) <= 0:
        raise ValueError("invalid_spacing")
    transform = functional(per, shared, ds, "PixelValueTransformationSequence")
    slope = numbers(transform, "RescaleSlope", 1)
    intercept = numbers(transform, "RescaleIntercept", 1)
    voi = functional(per, shared, ds, "FrameVOILUTSequence")
    content = functional(per, shared, ds, "FrameContentSequence")
    return Frame(
        number=number,
        dimensions=dimensions(ds, content),
        position=position,
        orientation=orientation,
        spacing=spacing,
        temporal=text(content, "TemporalPositionIndex") or text(ds, "TemporalPositionIdentifier"),
        stack=text(content, "StackID"),
        slope=slope[0] if slope else 1,
        intercept=intercept[0] if intercept else 0,
        window_center=numbers(voi, "WindowCenter"),
        window_width=numbers(voi, "WindowWidth"),
    )


def read_instance(member: Member, limits: Limits) -> Instance:
    ds = dcmread(member.stream, stop_before_pixels=True)
    sop = uid(ds, "SOPClassUID")
    if sop not in SOP_CLASSES:
        raise LookupError("unsupported_sop")
    rows, columns = int(ds.Rows), int(ds.Columns)
    count = int(getattr(ds, "NumberOfFrames", 1))
    if (
        rows <= 0
        or columns <= 0
        or rows * columns > limits.pixels_per_frame
        or not 1 <= count <= limits.frames
    ):
        raise ValueError("pixel_limit")
    bits, stored, high = int(ds.BitsAllocated), int(ds.BitsStored), int(ds.HighBit)
    if bits not in (8, 16) or not 1 <= stored <= bits or high != stored - 1:
        raise ValueError("invalid_bits")
    photometric = text(ds, "PhotometricInterpretation")
    if (
        photometric not in {"MONOCHROME1", "MONOCHROME2"}
        or int(ds.SamplesPerPixel) != 1
        or int(ds.PixelRepresentation) not in (0, 1)
    ):
        raise ValueError("unsupported_pixels")
    shared = sequence(ds, "SharedFunctionalGroupsSequence")
    per = getattr(ds, "PerFrameFunctionalGroupsSequence", None)
    enhanced = sop.endswith(".2.1") or sop.endswith(".4.1")
    if (per is not None and len(per) != count) or (enhanced and per is None):
        raise ValueError("invalid_frames")
    frames = [frame(ds, per[i] if per is not None else Dataset(), shared, i) for i in range(count)]
    if enhanced and any(f.position is None or f.orientation is None for f in frames):
        raise ValueError("missing_frame_geometry")
    return Instance(
        member=member.number,
        sha256=member.sha256,
        size=member.size,
        uid=uid(ds, "SOPInstanceUID"),
        study_uid=uid(ds, "StudyInstanceUID"),
        series_uid=uid(ds, "SeriesInstanceUID"),
        patient=text(ds, "PatientName"),
        description=text(ds, "StudyDescription"),
        series_description=text(ds, "SeriesDescription"),
        modality=SOP_CLASSES[sop],
        transfer_syntax=uid(ds.file_meta, "TransferSyntaxUID"),
        rows=rows,
        columns=columns,
        bits_allocated=bits,
        bits_stored=stored,
        high_bit=high,
        signed=bool(ds.PixelRepresentation),
        photometric=photometric,
        instance_number=int(getattr(ds, "InstanceNumber", 0) or 0),
        frames=frames,
    )


def _geometry_key(instance: Instance, item: Frame) -> tuple[object, ...]:
    return (
        instance.series_uid,
        instance.rows,
        instance.columns,
        tuple(item.dimensions),
        item.temporal,
        item.stack,
        tuple(round(v, 4) for v in item.orientation) if item.orientation else None,
        tuple(round(v, 4) for v in item.spacing) if item.spacing else None,
    )


def studies(instances: list[Instance]) -> list[Study]:
    grouped: dict[str, list[tuple[int, Instance]]] = {}
    for i, instance in enumerate(instances):
        grouped.setdefault(instance.study_uid, []).append((i, instance))
    result: list[Study] = []
    for study_uid, rows in grouped.items():
        groups: dict[tuple[object, ...], list[tuple[int, Frame]]] = {}
        for i, instance in rows:
            for item in instance.frames:
                groups.setdefault(_geometry_key(instance, item), []).append((i, item))
        stacks: list[Stack] = []
        warnings: set[str] = set()
        for frames in groups.values():
            geometric = all(f.position is not None and f.orientation is not None for _, f in frames)

            def order(
                pair: tuple[int, Frame], geometric: bool = geometric
            ) -> tuple[float, int, int]:
                i, f = pair
                if geometric and f.position is not None and f.orientation is not None:
                    a, b = f.orientation[:3], f.orientation[3:]
                    normal = (
                        a[1] * b[2] - a[2] * b[1],
                        a[2] * b[0] - a[0] * b[2],
                        a[0] * b[1] - a[1] * b[0],
                    )
                    distance = sum(x * y for x, y in zip(normal, f.position, strict=True))
                    return distance, instances[i].instance_number, f.number
                return float(instances[i].instance_number), i, f.number

            frames.sort(key=order)
            if not geometric:
                warnings.add("fallback_order")
            elif len({round(order(pair)[0], 4) for pair in frames}) != len(frames):
                warnings.add("overlapping_positions")
            first = instances[frames[0][0]]
            stacks.append(
                Stack(
                    series_uid=first.series_uid,
                    description=first.series_description,
                    ordering="geometry" if geometric else "instance_number",
                    frames=[(i, f.number) for i, f in frames],
                )
            )
        patients = sorted({instance.patient for _, instance in rows})
        if len(patients) > 1:
            warnings.add("multiple_patients")
        result.append(
            Study(
                uid=study_uid,
                description=rows[0][1].description,
                patients=patients,
                modalities=sorted({r.modality for _, r in rows}),
                stacks=stacks,
                warnings=sorted(warnings),
            )
        )
    return result


def inspect(path: Path, limits: Limits = DEFAULT_LIMITS) -> Manifest:
    manifest = Manifest()
    seen: dict[tuple[str, str], str] = {}
    frame_count = 0
    for member in members(path, limits):
        manifest.expanded_bytes += member.size
        code = None
        try:
            instance = read_instance(member, limits)
        except InvalidDicomError:
            code = "not_dicom"
        except LookupError:
            code = "unsupported_sop"
        except ValueError, AttributeError, TypeError, OverflowError, EOFError:
            code = "invalid_dicom"
        else:
            key = (instance.study_uid, instance.uid)
            if key in seen:
                if seen[key] != instance.sha256:
                    raise ArchiveError("conflicting_instance")
                code = "duplicate"
            else:
                seen[key] = instance.sha256
                frame_count += len(instance.frames)
                if frame_count > limits.frames:
                    raise ArchiveError("frame_limit")
                manifest.instances.append(instance)
        if code is not None:
            manifest.issues.append(Issue(member=member.number, name=member.name, code=code))
    manifest.studies = studies(manifest.instances)
    if not manifest.studies:
        raise ArchiveError("no_studies")
    return manifest
