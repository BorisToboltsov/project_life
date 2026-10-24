"""Private S3 transport. Only configured endpoints receive file bytes (I11)."""

from collections.abc import Iterator
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

import boto3
from botocore.config import Config

from app.config import get_settings

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

PART_SIZE = 8 * 1024 * 1024
URL_TTL = 900


class FileStorage:
    def __init__(self) -> None:
        settings = get_settings()
        options = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 2},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
        self.client: S3Client = boto3.client(  # pyright: ignore[reportUnknownMemberType]
            "s3",
            endpoint_url=settings.storage_url,
            region_name="garage",
            aws_access_key_id=settings.storage_key,
            aws_secret_access_key=settings.storage_secret.get_secret_value(),
            config=options,
        )
        self.signer: S3Client = boto3.client(  # pyright: ignore[reportUnknownMemberType]
            "s3",
            endpoint_url=settings.public_url,
            region_name="garage",
            aws_access_key_id=settings.storage_key,
            aws_secret_access_key=settings.storage_secret.get_secret_value(),
            config=options,
        )
        self.staging = settings.storage_staging_bucket
        self.objects = settings.storage_objects_bucket

    def start(self, key: str) -> str:
        return self.client.create_multipart_upload(
            Bucket=self.staging,
            Key=key,
            ContentType="application/octet-stream",
        )["UploadId"]

    def part_url(self, key: str, upload_id: str, part: int, size: int) -> str:
        signed = self.signer.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": self.staging,
                "Key": key,
                "UploadId": upload_id,
                "PartNumber": part,
                "ContentLength": size,
            },
            ExpiresIn=URL_TTL,
        )
        # Same-origin relative URL; no domain or authorization headers from the request.
        parsed = urlsplit(signed)
        return parsed.path + "?" + parsed.query

    def parts(self, key: str, upload_id: str) -> list[tuple[int, str, int]]:
        result: list[tuple[int, str, int]] = []
        pages = self.client.get_paginator("list_parts")
        for page in pages.paginate(Bucket=self.staging, Key=key, UploadId=upload_id):
            result.extend(
                (p.get("PartNumber", 0), p.get("ETag", ""), p.get("Size", 0))
                for p in page.get("Parts", [])
            )
        return result

    def finish(self, key: str, upload_id: str, parts: list[tuple[int, str, int]]) -> None:
        self.client.complete_multipart_upload(
            Bucket=self.staging,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": [{"PartNumber": n, "ETag": etag} for n, etag, _ in parts]},
        )

    def publish_copy(self, source: str, target: str) -> None:
        head = self.client.head_object(Bucket=self.staging, Key=source)
        self.client.copy_object(
            Bucket=self.objects,
            Key=target,
            CopySource={"Bucket": self.staging, "Key": source},
            CopySourceIfMatch=head["ETag"],
        )

    def chunks(self, key: str, byte_range: str | None = None) -> Iterator[bytes]:
        if byte_range is None:
            response = self.client.get_object(Bucket=self.objects, Key=key)
        else:
            response = self.client.get_object(Bucket=self.objects, Key=key, Range=byte_range)
        body = response["Body"]
        try:
            yield from body.iter_chunks(chunk_size=64 * 1024)
        finally:
            body.close()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.objects, Key=key)

    def abort(self, key: str, upload_id: str) -> None:
        self.client.abort_multipart_upload(Bucket=self.staging, Key=key, UploadId=upload_id)

    def list_objects(self, bucket: str) -> list[tuple[str, datetime]]:
        result: list[tuple[str, datetime]] = []
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
            result.extend(
                (obj["Key"], obj["LastModified"])
                for obj in page.get("Contents", [])
                if "Key" in obj and "LastModified" in obj
            )
        return result

    def list_uploads(self) -> list[tuple[str, str, datetime]]:
        result: list[tuple[str, str, datetime]] = []
        for page in self.client.get_paginator("list_multipart_uploads").paginate(
            Bucket=self.staging
        ):
            result.extend(
                (obj["Key"], obj["UploadId"], obj["Initiated"])
                for obj in page.get("Uploads", [])
                if "Key" in obj and "UploadId" in obj and "Initiated" in obj
            )
        return result

    def delete_staging(self, key: str) -> None:
        self.client.delete_object(Bucket=self.staging, Key=key)

    def restore_object(self, key: str, source: Path) -> None:
        with source.open("rb") as stream:
            self.client.put_object(Bucket=self.objects, Key=key, Body=stream)


@lru_cache
def file_storage() -> FileStorage:
    return FileStorage()
