"""Create Garage's private configuration and buckets without exposing credentials."""

import os
import secrets
import sys
import time
from pathlib import Path

from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings
from app.services.file_storage import file_storage


def config() -> None:
    target = Path("/config/garage.toml")
    if target.exists():
        return
    os.umask(0o077)
    target.write_text(
        'metadata_dir = "/data/meta"\ndata_dir = "/data/objects"\ndb_engine = "sqlite"\n'
        'replication_factor = 1\nrpc_bind_addr = "[::]:3901"\n'
        'rpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "' + secrets.token_hex(32) + '"\n'
        '[s3_api]\ns3_region = "garage"\napi_bind_addr = "[::]:3900"\n'
    )


def buckets() -> None:
    settings = get_settings()
    storage = file_storage()
    for attempt in range(60):
        try:
            for bucket in (settings.storage_staging_bucket, settings.storage_objects_bucket):
                try:
                    storage.client.head_bucket(Bucket=bucket)
                except ClientError as error:
                    if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 404:
                        raise
                    storage.client.create_bucket(Bucket=bucket)
            return
        except BotoCoreError, ClientError:
            if attempt == 59:
                raise RuntimeError("storage_initialization_failed") from None
            time.sleep(1)


if __name__ == "__main__":
    if sys.argv[1:] == ["config"]:
        config()
    elif sys.argv[1:] == ["buckets"]:
        buckets()
    else:
        raise SystemExit(2)
