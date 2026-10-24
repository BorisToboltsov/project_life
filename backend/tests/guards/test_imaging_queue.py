"""Real PostgreSQL delivery, deduplication and heartbeat recovery."""

from collections.abc import AsyncIterator
from pathlib import Path

import procrastinate
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.imaging import processing
from app.imaging.queue import create_queue, reconcile
from tests.conftest import MakeUser
from tests.guards.test_imaging_archive import archive, dicom, encoded
from tests.guards.test_imaging_storage import Storage, seeded

pytestmark = pytest.mark.anyio


@pytest.fixture
async def queue() -> AsyncIterator[procrastinate.App]:
    app = create_queue()
    async with app.open_async():
        yield app
        await app.connector.execute_query_async(
            "TRUNCATE procrastinate_jobs, procrastinate_workers RESTART IDENTITY CASCADE"
        )


async def test_lost_delivery_and_duplicates_converge(
    queue: procrastinate.App,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = archive(tmp_path, [("scan.dcm", encoded(dicom()))]).read_bytes()
    row = await seeded(db, make_user, data)
    storage = Storage()
    storage.published[row.object_key] = data
    monkeypatch.setattr(processing, "file_storage", lambda: storage)
    await reconcile(queue)
    await reconcile(queue)
    jobs = await queue.connector.execute_query_all_async("SELECT args FROM procrastinate_jobs")
    assert jobs == [{"args": {"import_id": str(row.id)}}]
    await queue.run_worker_async(wait=False, install_signal_handlers=False)
    await db.refresh(row)
    assert row.state == "awaiting_confirmation"
    await db.rollback()
    await reconcile(queue)
    jobs = await queue.connector.execute_query_all_async("SELECT status FROM procrastinate_jobs")
    assert jobs == [{"status": "succeeded"}]


async def test_storage_failure_retries_without_publishing(
    queue: procrastinate.App,
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = await seeded(db, make_user, b"archive")

    def unavailable() -> Storage:
        raise OSError("private transport diagnostic")

    monkeypatch.setattr(processing, "file_storage", unavailable)
    await reconcile(queue)
    await queue.run_worker_async(wait=False, install_signal_handlers=False)
    await db.refresh(row)
    assert row.state == "inspecting"
    assert row.manifest is None
    jobs = await queue.connector.execute_query_all_async(
        "SELECT status, attempts FROM procrastinate_jobs"
    )
    assert jobs == [{"status": "todo", "attempts": 1}]


async def test_dead_heartbeat_recovers_but_live_worker_is_untouched(
    queue: procrastinate.App,
    db: AsyncSession,
    make_user: MakeUser,
) -> None:
    await seeded(db, make_user, b"archive")
    await reconcile(queue)
    worker_id = await queue.job_manager.register_worker()
    job = await queue.job_manager.fetch_job(queues=["imaging"], worker_id=worker_id)
    assert job is not None
    await reconcile(queue)
    doing = await queue.connector.execute_query_all_async(
        "SELECT id FROM procrastinate_jobs WHERE status='doing'"
    )
    assert doing == [{"id": job.id}]
    await queue.connector.execute_query_async(
        "UPDATE procrastinate_workers SET last_heartbeat=now()-interval '5 minutes'"
    )
    await reconcile(queue)
    doing = await queue.connector.execute_query_all_async(
        "SELECT id FROM procrastinate_jobs WHERE status='doing'"
    )
    assert doing == []


async def test_killed_worker_rolls_back_and_job_is_recovered(
    queue: procrastinate.App,
    db: AsyncSession,
    make_user: MakeUser,
    tmp_path: Path,
) -> None:
    import asyncio
    import sys

    row = await seeded(db, make_user, b"archive")
    await reconcile(queue)
    marker = tmp_path / "transaction-open"
    source = """
import asyncio, sys
from pathlib import Path
from uuid import UUID
from app.db import session_factory
from app.files import file_mutation
from app.models import ImagingImport
from app.imaging import queue
async def interrupted(import_id):
    async with session_factory() as db:
        await file_mutation(db)
        row = await db.get(ImagingImport, UUID(str(import_id)), with_for_update=True)
        row.state = 'awaiting_confirmation'
        await db.flush()
        Path(sys.argv[1]).write_text('ready')
        await asyncio.Event().wait()
queue.process_inspection = interrupted
asyncio.run(queue.main())
"""
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        source,
        str(marker),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        for _ in range(200):
            if marker.exists():
                break
            assert process.returncode is None, "test worker exited before opening a transaction"
            await asyncio.sleep(0.05)
        assert marker.exists(), "test worker did not start its job"
    finally:
        if process.returncode is None:
            process.kill()
        await asyncio.wait_for(process.wait(), timeout=10)
    await db.refresh(row)
    assert row.state == "inspecting"
    assert row.manifest is None
    await db.commit()
    await queue.connector.execute_query_async(
        "UPDATE procrastinate_workers SET last_heartbeat=now()-interval '5 minutes'"
    )
    await reconcile(queue)
    jobs = await queue.connector.execute_query_all_async(
        "SELECT status, attempts FROM procrastinate_jobs"
    )
    assert jobs == [{"status": "todo", "attempts": 1}]
