"""PostgreSQL delivery; import state is the durable source of pending work."""

import asyncio
import shutil
import tempfile
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import procrastinate
from procrastinate.exceptions import AlreadyEnqueued
from sqlalchemy import select, text
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import session_factory
from app.imaging.processing import process_inspection
from app.log import configure_logging
from app.models import ImagingImport


def create_queue() -> procrastinate.App:
    dsn = (
        make_url(get_settings().database_url)
        .set(drivername="postgresql")
        .render_as_string(hide_password=False)
    )
    app = procrastinate.App(
        connector=procrastinate.PsycopgConnector(
            conninfo=dsn,
            kwargs={"options": "-csearch_path=imaging_queue,public"},
            min_size=1,
            max_size=4,
        )
    )

    @app.task(name="inspect_original", queue="imaging", retry=procrastinate.RetryStrategy(wait=60))
    async def inspect_original(import_id: str) -> None:
        await process_inspection(UUID(import_id))

    return app


async def reconcile(app: procrastinate.App) -> None:
    async with session_factory() as db:
        # Serialize reconcilers, including deployments with overlapping workers.
        if not await db.scalar(text("SELECT pg_try_advisory_xact_lock(130014)")):
            return
        for job in await app.job_manager.get_stalled_jobs(
            queue="imaging", seconds_since_heartbeat=120
        ):
            if job.id is not None:
                await app.job_manager.retry_job_by_id_async(job.id, retry_at=datetime.now(UTC))
        # Do not enqueue behind a running job: its own retry needs the queueing lock.
        active = set(
            await db.scalars(
                text(
                    "SELECT args->>'import_id' FROM imaging_queue.procrastinate_jobs "
                    "WHERE status IN ('todo','doing') AND task_name='inspect_original'"
                )
            )
        )
        ids = list(
            await db.scalars(
                select(ImagingImport.id).where(ImagingImport.state.in_(["inspecting", "importing"]))
            )
        )
        for import_id in ids:
            if str(import_id) in active:
                continue
            with suppress(AlreadyEnqueued):
                await app.configure_task(
                    name="inspect_original",
                    queue="imaging",
                    lock=str(import_id),
                    queueing_lock=str(import_id),
                ).defer_async(import_id=str(import_id))


async def maintain(app: procrastinate.App) -> None:
    while True:
        try:
            await reconcile(app)
        except Exception:
            print("imaging_queue_reconcile_failed", flush=True)  # noqa: T201
        await asyncio.sleep(30)


async def main() -> None:
    configure_logging(get_settings().log_level)
    app = create_queue()
    async with app.open_async():
        maintenance = asyncio.create_task(maintain(app))
        try:
            await app.run_worker_async(
                queues=["imaging"],
                concurrency=1,
                delete_jobs="successful",
                update_heartbeat_interval=10,
                stalled_worker_timeout=120,
            )
        finally:
            maintenance.cancel()
            await asyncio.gather(maintenance, return_exceptions=True)


if __name__ == "__main__":
    if tempfile.gettempdir() == "/scratch":
        for pattern in ("life-original-*", "life-imaging-*"):
            for directory in Path("/scratch").glob(pattern):
                if directory.is_dir() and not directory.is_symlink():
                    shutil.rmtree(directory)
    asyncio.run(main())
