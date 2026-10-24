"""Гейт исходящих запросов (инвариант I11): наружу уходит только штрихкод или текст поиска.

Единственный внешний сервис, к которому обращается сервер, — Open Food Facts. Гейт
проверяет три вещи:
- состав обоих запросов — по штрихкоду и по названию — закрыт: метод, адрес, параметры и
  заголовки названы поимённо, новое делает гейт красным;
- запрос не зависит от того, кто спрашивает: ни пользователь, ни его язык, ни заголовки
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
from app.services.open_food_facts import FIELDS, SEARCH_FIELDS
from tests.conftest import SEARCH_HOST, Account, MakeUser, OffStub
from tests.nutrition import EAN_8, EAN_13, search_outside

pytestmark = pytest.mark.anyio

# Примета, которой нет в коде: всплыла в запросе наружу — значит, утекла из запроса клиента.
MARKER = "leak-5c1d8e2a"
# Модуль, которому можно открывать соединения наружу.
OUTBOUND_MODULE = "services/open_food_facts.py"
NETWORK_IMPORT = re.compile(
    r"^\s*(?:import|from)\s+"
    r"(httpx|urllib\.request|urllib3|http\.client|aiohttp|requests|websockets|socket|smtplib|ftplib|boto3)\b",
    re.MULTILINE,
)


async def two_people(db: AsyncSession, make_user: MakeUser) -> tuple[Account, Account]:
    """Двое с разными языками; почта первого несёт примету."""
    russian, english = await make_user(email=f"{MARKER}@example.com"), await make_user()
    await db.execute(update(User).where(User.email != russian.email).values(language=Language.EN))
    await db.commit()
    return russian, english


def telling_headers(account: Account) -> dict[str, str]:
    """Запрос клиента, в котором примета стоит всюду, где её можно унести наружу."""
    return {
        **account.headers,
        "User-Agent": f"Browser/{MARKER}",
        "Accept-Language": f"ru-{MARKER}",
        "Cookie": f"session={MARKER}",
        "X-Forwarded-For": "203.0.113.7",
        "Referer": f"https://life.example.com/{MARKER}",
    }


def assert_tells_nothing(off: OffStub, asker: Account) -> None:
    first, second = off.requests
    assert first.method == "GET"
    assert first.content == b""
    # Состав запроса закрыт. Новый заголовок — сначала правка инварианта I11.
    assert set(first.headers) == {"host", "accept", "accept-encoding", "connection", "user-agent"}
    assert re.fullmatch(
        r"project_life/\d+\.\d+\.\d+ \(https://github\.com/[\w-]+/project_life\)",
        first.headers["user-agent"],
    )
    # Ничего от того, кто спрашивал: ни его токена, ни адреса, ни заголовков, ни почты.
    sent = f"{first.url}\n{first.headers!r}\n{second.url}\n{second.headers!r}"
    for secret in (MARKER, asker.id, "Bearer", "203.0.113.7"):
        assert secret not in sent
    assert {name: value for name, value in second.headers.items() if name != "host"} == {
        name: value for name, value in first.headers.items() if name != "host"
    }


async def test_request_to_the_source_carries_only_the_barcode(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    russian, english = await two_people(db, make_user)

    await client.post(
        "/api/products/lookup", json={"barcode": EAN_13}, headers=telling_headers(russian)
    )
    await client.post("/api/products/lookup", json={"barcode": EAN_8}, headers=english.headers)

    first, second = off.requests
    # Параметры запроса закрыты так же, как заголовки: новый — сначала правка I11.
    assert (
        str(first.url)
        == f"https://off.test/api/v2/product/{EAN_13}?fields={FIELDS.replace(',', '%2C')}"
    )
    assert_tells_nothing(off, russian)
    # Запрос другого человека на другом языке отличается только штрихкодом.
    assert str(second.url) == str(first.url).replace(EAN_13, EAN_8)
    assert second.headers == first.headers


async def test_search_by_name_carries_only_the_text(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    russian, english = await two_people(db, make_user)

    await client.get(
        "/api/products/external", params={"q": "Творог"}, headers=telling_headers(russian)
    )
    await search_outside(client, english, "Kefir", page=2)

    first, second = off.requests
    assert str(first.url.copy_with(query=None)) == f"https://{SEARCH_HOST}/search"
    # Параметры названы поимённо; языки — все языки приложения, а не язык того, кто ищет.
    assert dict(first.url.params) == {
        "q": "творог",
        "langs": "en,ru",
        "page_size": "20",
        "page": "1",
        "fields": SEARCH_FIELDS,
    }
    assert_tells_nothing(off, russian)
    # Запрос другого человека на другом языке отличается только текстом и страницей.
    assert dict(second.url.params) == {**dict(first.url.params), "q": "kefir", "page": "2"}
    assert second.headers == first.headers


async def test_search_text_reaches_the_source_as_plain_words(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    """Текст — единственное, что человек отправляет наружу сам; уходит он без знаков, из
    которых сервис собрал бы свой запрос."""
    await search_outside(client, await make_user(), 'code:"4600000000008" OR (Творог-5%)')

    [request] = off.requests
    assert request.url.params["q"] == "code 4600000000008 or творог 5%"


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
    assert offenders == {OUTBOUND_MODULE: ["httpx"], "services/file_storage.py": ["boto3"]}
