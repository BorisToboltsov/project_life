"""Гейт сбора ошибок (инвариант I9): в отчёте об ошибке нет данных пользователя.

Отчёт — это место в коде: тип исключения, шаблон маршрута, кадры стека, версия. Гейт
проверяет три вещи:
- состав отчёта закрыт: новое поле в таблице или в теле запроса делает гейт красным;
- сбой на сервере не уносит в отчёт ничего из запроса — ни адреса, ни тела, ни
  заголовков, ни текста исключения, ни того, кто его вызвал;
- отчёт с устройства принимается только в жёсткой форме: свободный текст не проходит.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import measurements
from app.models import ErrorReport
from app.schemas import ErrorFrameIn, ErrorReportIn
from tests.conftest import MakeUser

pytestmark = pytest.mark.anyio

# Примета, которой нет в коде: всплыла в отчёте — значит, утекла из запроса.
MARKER = "leak-7f3a9c1e"
VALUE = "187.654"


async def everything_stored(db: AsyncSession) -> str:
    """Все значения всех отчётов одной строкой."""
    reports = list(await db.scalars(select(ErrorReport)))
    assert reports, "отчёт не сохранён — проверять нечего"
    return "\n".join(
        str(getattr(report, column.key))
        for report in reports
        for column in ErrorReport.__table__.columns
    )


def test_report_has_no_room_for_anything_else() -> None:
    """Состав отчёта закрыт. Новое поле — осознанное решение: сначала инвариант I9."""
    assert {column.key for column in ErrorReport.__table__.columns} == {
        "id",
        "fingerprint",
        "source",
        "kind",
        "place",
        "stack",
        "version",
        "count",
        "first_seen",
        "last_seen",
    }
    assert set(ErrorReportIn.model_fields) == {"kind", "route", "frames", "version"}
    assert set(ErrorFrameIn.model_fields) == {"file", "line", "column", "function"}


async def test_server_error_takes_nothing_from_the_request(
    crash_client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user(email=f"{MARKER}@example.com")
    record_id = uuid.uuid7()

    async def fail(*_: object) -> None:
        raise RuntimeError(f"cannot save {VALUE} of {user.email} as {record_id}: {MARKER}")

    monkeypatch.setattr(measurements, "_own_measurement", fail)
    now = datetime.now(UTC)

    response = await crash_client.put(
        f"/api/measurements/{record_id}",
        params={"note": MARKER},
        headers={**user.headers, "X-Note": MARKER, "User-Agent": f"browser/{MARKER}"},
        json={
            "metric": "weight",
            "value": VALUE,
            "unit": "kg",
            "measured_at": now.isoformat(),
            "local_date": now.date().isoformat(),
        },
    )

    assert response.status_code == 500
    stored = await everything_stored(db)
    for secret in (MARKER, VALUE, str(record_id), user.id, user.email, "cannot save"):
        assert secret not in stored, f"в отчёт об ошибке попало {secret!r}"


async def test_client_report_does_not_name_its_sender(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user(email=f"{MARKER}@example.com")
    report = {
        "kind": "TypeError",
        "route": "/measurements/$metric/$id",
        "frames": [{"file": "assets/index-B3x9.js", "line": 1, "column": 2, "function": "Zr"}],
        "version": "0.2.4",
    }

    response = await client.post(
        "/api/errors", headers={**user.headers, "User-Agent": f"browser/{MARKER}"}, json=report
    )

    assert response.status_code == 204
    stored = await everything_stored(db)
    for secret in (MARKER, user.id, user.email):
        assert secret not in stored, f"в отчёт об ошибке попало {secret!r}"


def _frame(**overrides: Any) -> dict[str, Any]:
    return {"file": "assets/index-B3x9.js", "line": 1, "column": 2, "function": "Zr", **overrides}


FREE_TEXT: dict[str, dict[str, Any]] = {
    "сообщение исключения вместо типа": {"kind": "Cannot read properties of undefined"},
    "тип с текстом после двоеточия": {"kind": "Error: weight 72.4 is wrong"},
    "адрес страницы с идентификатором записи": {
        "route": "/measurements/weight/0199b7a0-0000-7000-8000-000000000001"
    },
    "адрес со строкой запроса": {"route": "/measurements/weight?from=2026-01-01"},
    "адрес целиком": {"route": "https://life.example.com/profile"},
    "страница вместо файла скрипта": {"frames": [_frame(file="measurements/weight/0199b7a0")]},
    "адрес скрипта со строкой запроса": {"frames": [_frame(file="assets/a.js?user=anna")]},
    "фраза вместо имени функции": {"frames": [_frame(function="weight is 72 kg")]},
    "лишнее поле кадра": {"frames": [_frame(source="const weight = 72.4")]},
    "поле с текстом ошибки": {"message": "Cannot save weight 72.4"},
    "поле с пользователем": {"user": "anna@example.com"},
    "версия с припиской": {"version": "0.2.4 (anna)"},
}


@pytest.mark.parametrize("case", FREE_TEXT)
async def test_client_report_must_fit_the_strict_shape(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, case: str
) -> None:
    user = await make_user()
    report = {"kind": "TypeError", "route": "/", "frames": [_frame()], "version": "0.2.4"}

    response = await client.post(
        "/api/errors", headers=user.headers, json={**report, **FREE_TEXT[case]}
    )

    assert response.status_code == 422, f"принят отчёт, в котором {case}"
    assert list(await db.scalars(select(ErrorReport))) == []
