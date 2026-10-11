"""Гейт исходящих запросов (инвариант I11): наружу уходит только штрихкод.

Единственный внешний сервис, к которому обращается сервер, — Open Food Facts. Гейт
проверяет три вещи:
- состав запроса закрыт: метод, путь, параметры и заголовки названы поимённо, новое —
  делает гейт красным;
- запрос не зависит от того, кто сканирует: ни пользователь, ни его язык, ни заголовки
  его запроса в него не попадают;
- код, который умеет ходить в сеть, лежит в одном модуле.
"""

import re
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

import app
from app.models import Language, User
from app.services.open_food_facts import FIELDS
from tests.conftest import MakeUser, OffStub
from tests.nutrition import EAN_8, EAN_13

pytestmark = pytest.mark.anyio

# Примета, которой нет в коде: всплыла в запросе наружу — значит, утекла из запроса клиента.
MARKER = "leak-5c1d8e2a"
# Модуль, которому можно открывать соединения наружу.
OUTBOUND_MODULE = "services/open_food_facts.py"
NETWORK_IMPORT = re.compile(
    r"^\s*(?:import|from)\s+"
    r"(httpx|urllib\.request|urllib3|http\.client|aiohttp|requests|websockets|socket|smtplib|ftplib)\b",
    re.MULTILINE,
)


async def test_request_to_the_source_carries_only_the_barcode(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    russian, english = await make_user(email=f"{MARKER}@example.com"), await make_user()
    await db.execute(update(User).where(User.email != russian.email).values(language=Language.EN))
    await db.commit()

    await client.post(
        "/api/products/lookup",
        json={"barcode": EAN_13},
        headers={
            **russian.headers,
            "User-Agent": f"Browser/{MARKER}",
            "Accept-Language": f"ru-{MARKER}",
            "Cookie": f"session={MARKER}",
            "X-Forwarded-For": "203.0.113.7",
            "Referer": f"https://life.example.com/{MARKER}",
        },
    )
    await client.post("/api/products/lookup", json={"barcode": EAN_8}, headers=english.headers)

    first, second = off.requests
    assert first.method == "GET"
    assert (
        str(first.url)
        == f"https://off.test/api/v2/product/{EAN_13}?fields={FIELDS.replace(',', '%2C')}"
    )
    assert first.content == b""
    # Состав запроса закрыт. Новый заголовок или параметр — сначала правка инварианта I11.
    assert set(first.headers) == {"host", "accept", "accept-encoding", "connection", "user-agent"}
    assert re.fullmatch(
        r"project_life/\d+\.\d+\.\d+ \(https://github\.com/[\w-]+/project_life\)",
        first.headers["user-agent"],
    )
    # Ничего от того, кто сканировал: ни его токена, ни адреса, ни заголовков, ни почты.
    sent = f"{first.url}\n{first.headers!r}\n{second.url}\n{second.headers!r}"
    for secret in (MARKER, russian.id, "Bearer", "203.0.113.7"):
        assert secret not in sent
    # Запрос другого человека на другом языке отличается только штрихкодом.
    assert str(second.url) == str(first.url).replace(EAN_13, EAN_8)
    assert second.headers == first.headers


def test_only_one_module_opens_connections() -> None:
    """Новый внешний сервис — осознанное решение: сначала инвариант I11."""
    package = Path(app.__file__).parent
    sources = sorted(package.rglob("*.py"))

    offenders = {
        str(source.relative_to(package)): NETWORK_IMPORT.findall(source.read_text())
        for source in sources
        if NETWORK_IMPORT.search(source.read_text())
    }

    assert len(sources) > 20, "обход пакета пуст или неполон"
    assert offenders == {OUTBOUND_MODULE: ["httpx"]}
