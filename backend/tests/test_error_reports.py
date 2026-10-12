import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

from app import __version__
from app.api import error_reports as capture
from app.api import measurements
from app.models import ErrorReport, ErrorSource
from app.services import error_reports
from app.services.error_reports import Report, from_exception
from tests.conftest import MakeUser

pytestmark = pytest.mark.anyio


def measurement_body() -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "metric_id": str(uuid.uuid7()),
        "value": 72.4,
        "unit": "kg",
        "measured_at": now.isoformat(),
        "local_date": now.date().isoformat(),
    }


def client_report(**overrides: Any) -> dict[str, Any]:
    return {
        "kind": "TypeError",
        "route": "/measurements/$metric",
        "frames": [
            {"file": "assets/index-B3x9.js", "line": 45, "column": 12345, "function": "Zr"},
            {"file": "assets/index-B3x9.js", "line": 45, "column": 999},
        ],
        "version": "0.2.4",
        **overrides,
    }


async def stored(db: AsyncSession) -> list[ErrorReport]:
    db.expire_all()
    return list(await db.scalars(select(ErrorReport).order_by(ErrorReport.last_seen)))


@pytest.fixture
def broken_save(monkeypatch: pytest.MonkeyPatch) -> None:
    """Сохранение замера падает необработанным исключением."""

    async def fail(*_: object) -> None:
        raise RuntimeError("database is on fire")

    monkeypatch.setattr(measurements, "_own_measurement", fail)


@pytest.mark.usefixtures("broken_save")
async def test_unhandled_error_becomes_a_report(
    crash_client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()
    path = f"/api/measurements/{uuid.uuid7()}"

    response = await crash_client.put(path, headers=user.headers, json=measurement_body())

    assert response.status_code == 500
    [report] = await stored(db)
    assert report.source == ErrorSource.BACKEND
    assert report.kind == "RuntimeError"
    assert report.place == "PUT /api/measurements/{measurement_id}"
    assert report.version == __version__
    assert report.count == 1
    frames = report.stack.splitlines()
    # Ближайший к сбою кадр — последний; путь файла — от корня пакета.
    assert frames[-1].startswith("test_error_reports.py:")
    assert any(
        frame.startswith("app/api/measurements.py:") and frame.endswith(" save_measurement")
        for frame in frames
    )


@pytest.mark.usefixtures("broken_save")
async def test_repeated_error_only_counts(
    crash_client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    first, second = await make_user(), await make_user()

    for user in (first, second, first):
        await crash_client.put(
            f"/api/measurements/{uuid.uuid7()}", headers=user.headers, json=measurement_body()
        )

    [report] = await stored(db)
    assert report.count == 3
    assert report.last_seen > report.first_seen


async def test_refusals_are_not_errors(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()

    anonymous = await client.get("/api/me")
    missing = await client.delete(f"/api/measurements/{uuid.uuid7()}", headers=user.headers)
    invalid = await client.put(
        f"/api/measurements/{uuid.uuid7()}", headers=user.headers, json={"metric": "mood"}
    )

    assert (anonymous.status_code, missing.status_code, invalid.status_code) == (401, 404, 422)
    assert await stored(db) == []


@pytest.mark.usefixtures("broken_save")
async def test_failed_recording_keeps_the_original_error(
    crash_client: AsyncClient,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def fail(_: Report) -> None:
        raise OSError("no connection")

    monkeypatch.setattr(error_reports, "record", fail)
    user = await make_user()

    with caplog.at_level(logging.WARNING, logger=capture.__name__):
        response = await crash_client.put(
            f"/api/measurements/{uuid.uuid7()}", headers=user.headers, json=measurement_body()
        )

    assert response.status_code == 500
    assert "не удалось сохранить отчёт об ошибке" in caplog.text


async def test_error_outside_a_route_has_no_place(db: AsyncSession) -> None:
    async def broken(scope: Scope, receive: Receive, send: Send) -> None:
        raise LookupError

    scope = {"type": "http", "method": "GET", "path": "/api/whatever/42", "app": FastAPI()}
    with pytest.raises(LookupError):
        await capture.CaptureErrors(broken)(scope, _never, _nowhere)

    [report] = await stored(db)
    assert report.kind == "LookupError"
    assert report.place is None


async def test_only_requests_are_captured(db: AsyncSession) -> None:
    async def broken(scope: Scope, receive: Receive, send: Send) -> None:
        raise LookupError

    with pytest.raises(LookupError):
        await capture.CaptureErrors(broken)({"type": "lifespan"}, _never, _nowhere)

    assert await stored(db) == []


async def _never() -> dict[str, Any]:
    raise AssertionError


async def _nowhere(_: Any) -> None:
    raise AssertionError


def test_exception_kind_names_its_module() -> None:
    class Custom(Exception):
        pass

    assert from_exception(KeyError("secret"), None).kind == "KeyError"
    assert from_exception(Custom(), None).kind == (
        "tests.test_error_reports.test_exception_kind_names_its_module.<locals>.Custom"
    )


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("/srv/.venv/lib/python3.14/site-packages/app/api/me.py", "app/api/me.py"),
        (
            "/srv/.venv/lib/python3.14/site-packages/sqlalchemy/engine/base.py",
            "sqlalchemy/engine/base.py",
        ),
        ("/Users/someone/project/backend/src/app/main.py", "app/main.py"),
        ("/Users/someone/project/backend/tests/test_me.py", "test_me.py"),
        ("<frozen importlib._bootstrap>", "<frozen importlib._bootstrap>"),
        ("", ""),
    ],
)
def test_frame_file_drops_machine_directories(filename: str, expected: str) -> None:
    assert error_reports._frame_file(filename) == expected  # pyright: ignore[reportPrivateUsage]


async def test_stack_keeps_the_frames_nearest_to_the_failure() -> None:
    def dive(depth: int) -> None:
        if depth == 0:
            raise ValueError
        dive(depth - 1)

    with pytest.raises(ValueError) as caught:  # noqa: PT011
        dive(error_reports.MAX_FRAMES + 5)

    frames = from_exception(caught.value, None).frames
    assert len(frames) == error_reports.MAX_FRAMES
    assert frames[-1].endswith(".<locals>.dive")


async def test_client_report_is_stored(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()

    response = await client.post("/api/errors", headers=user.headers, json=client_report())
    again = await client.post("/api/errors", headers=user.headers, json=client_report())

    assert (response.status_code, again.status_code) == (204, 204)
    [report] = await stored(db)
    assert report.source == ErrorSource.FRONTEND
    assert report.kind == "TypeError"
    assert report.place == "/measurements/$metric"
    assert report.stack == "assets/index-B3x9.js:45:12345 Zr\nassets/index-B3x9.js:45:999"
    assert report.version == "0.2.4"
    assert report.count == 2


async def test_repeat_on_a_new_version_updates_the_version(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()

    await client.post("/api/errors", headers=user.headers, json=client_report())
    await client.post("/api/errors", headers=user.headers, json=client_report(version="0.3.0"))

    [report] = await stored(db)
    assert (report.count, report.version) == (2, "0.3.0")


async def test_route_and_frames_are_optional(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()
    body: dict[str, Any] = {"kind": "NonError", "frames": [], "version": "0.2.4"}

    response = await client.post("/api/errors", headers=user.headers, json=body)

    assert response.status_code == 204
    [report] = await stored(db)
    assert (report.place, report.stack) == (None, "")


async def test_oldest_reports_give_way_to_new_ones(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(error_reports, "MAX_REPORTS", 2)
    user = await make_user()

    for kind in ("First", "Second", "First", "Third"):
        await client.post("/api/errors", headers=user.headers, json=client_report(kind=kind))

    # «Second» дольше всех не повторялась — вытеснена она, а не самая старая по созданию.
    assert [report.kind for report in await stored(db)] == ["First", "Third"]


async def test_admin_lists_and_deletes_reports(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(admin=True)
    for kind in ("Older", "Newer"):
        await client.post("/api/errors", headers=admin.headers, json=client_report(kind=kind))

    listed = await client.get("/api/admin/errors", headers=admin.headers)

    assert listed.status_code == 200
    newer, older = listed.json()
    assert (newer["kind"], older["kind"]) == ("Newer", "Older")
    assert set(newer) == {
        "id",
        "source",
        "kind",
        "place",
        "stack",
        "version",
        "count",
        "first_seen",
        "last_seen",
    }

    deleted = await client.delete(f"/api/admin/errors/{newer['id']}", headers=admin.headers)
    again = await client.delete(f"/api/admin/errors/{newer['id']}", headers=admin.headers)

    assert (deleted.status_code, again.status_code) == (204, 404)
    remaining = (await client.get("/api/admin/errors", headers=admin.headers)).json()
    assert [report["kind"] for report in remaining] == ["Older"]
