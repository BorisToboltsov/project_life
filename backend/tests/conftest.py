import os
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from itertools import count
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from psycopg import sql
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

TEST_DATABASE_URL = os.environ.get(
    "LIFE_TEST_DATABASE_URL", "postgresql+psycopg://life:life@localhost:5433/life_test"
)
# Выставляется до первого импорта app.*: настройки и движок создаются при импорте.
os.environ["LIFE_ENVIRONMENT"] = "test"
os.environ["LIFE_DATABASE_URL"] = TEST_DATABASE_URL
# Наружу тесты не ходят: Open Food Facts выключен, пока тест не подменит его фикстурой `off`.
os.environ["LIFE_OFF_URL"] = ""

PASSWORD = "correct horse battery"


def alembic_config() -> Config:
    return Config(Path(__file__).parent.parent / "alembic.ini")


def sync_url(database: str | None = None) -> str:
    url = make_url(TEST_DATABASE_URL).set(drivername="postgresql")
    return (url.set(database=database) if database else url).render_as_string(hide_password=False)


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    """Пересоздаёт тестовую базу и накатывает миграции — тесты идут на реальном PostgreSQL."""
    name = make_url(TEST_DATABASE_URL).database
    if name is None or not name.endswith("_test"):
        raise RuntimeError(f"Тестовая база должна называться *_test, получено: {name!r}")
    with psycopg.connect(sync_url("postgres"), autocommit=True) as conn:
        conn.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
        )
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
def clean_tables() -> Iterator[None]:
    """Тесты фиксируют транзакции по-настоящему, поэтому после каждого таблицы очищаются."""
    yield
    from app.db import Base

    tables = sql.SQL(", ").join(sql.Identifier(table.name) for table in Base.metadata.sorted_tables)
    with psycopg.connect(sync_url(), autocommit=True) as conn:
        conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(tables))


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def new_client(*, raise_app_exceptions: bool = True) -> AsyncClient:
    from app.main import app

    # https: иначе httpx не вернёт серверу cookie с флагом Secure.
    transport = ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions)
    return AsyncClient(transport=transport, base_url="https://test")


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with new_client() as client:
        yield client


@pytest.fixture
async def crash_client() -> AsyncIterator[AsyncClient]:
    """Клиент для сбоев: необработанное исключение приходит ответом 500, как у настоящего."""
    async with new_client(raise_app_exceptions=False) as client:
        yield client


@pytest.fixture
async def db() -> AsyncIterator[AsyncSession]:
    from app.db import session_factory

    async with session_factory() as session:
        yield session


@dataclass(frozen=True)
class Account:
    id: str
    email: str
    password: str
    headers: dict[str, str]


MakeUser = Callable[..., Awaitable[Account]]

_numbers = count(1)


@pytest.fixture
def make_user() -> MakeUser:
    async def make(*, admin: bool = False, email: str | None = None) -> Account:
        from app.db import session_factory
        from app.models import Language, Role, User, preset_meals
        from app.security.passwords import hash_password
        from app.security.tokens import create_access_token

        user = User(
            email=email or f"user{next(_numbers)}@example.com",
            password_hash=await hash_password(PASSWORD),
            display_name="Тестовый пользователь",
            role=Role.ADMIN if admin else Role.USER,
            language=Language.RU,
            timezone="Europe/Moscow",
            disclaimer_accepted_at=datetime.now(UTC),
        )
        async with session_factory() as session:
            session.add(user)
            await session.flush()
            # Как при регистрации: пользователь начинает с предустановленных приёмов пищи.
            session.add_all(preset_meals(user.id))
            await session.commit()
        token, _ = create_access_token(user.id)
        return Account(str(user.id), user.email, PASSWORD, {"Authorization": f"Bearer {token}"})

    return make


@dataclass
class OffStub:
    """Подменный Open Food Facts: ответы задаёт тест, запросы приложения записываются."""

    # Штрихкод → продукт, как его отдаёт сервис; неизвестный штрихкод — «не найдено».
    products: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])
    # Ответ на любой запрос вместо обычного: сбой сервиса или сети.
    broken: httpx.Response | Exception | None = None
    # Что происходит в приложении, пока сервис думает над ответом.
    meanwhile: Callable[[], Awaitable[object]] | None = None
    requests: list[httpx.Request] = field(default_factory=list[httpx.Request])

    async def respond(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.meanwhile is not None:
            await self.meanwhile()
        if isinstance(self.broken, Exception):
            raise self.broken
        if self.broken is not None:
            return self.broken
        barcode = request.url.path.rsplit("/", 1)[-1]
        if barcode not in self.products:
            return httpx.Response(
                404, json={"code": barcode, "status": 0, "status_verbose": "product not found"}
            )
        return httpx.Response(
            200, json={"code": barcode, "status": 1, "product": self.products[barcode]}
        )

    def connect(self) -> None:
        """Ставит приложению клиент, который ходит сюда; пределы частоты у него с нуля."""
        from app.main import app
        from app.services.open_food_facts import OpenFoodFacts, get_open_food_facts

        source = OpenFoodFacts("https://off.test", httpx.MockTransport(self.respond))
        app.dependency_overrides[get_open_food_facts] = lambda: source


@pytest.fixture
def off() -> Iterator[OffStub]:
    """Включает поиск в Open Food Facts и подменяет сам сервис."""
    from app.main import app
    from app.services.open_food_facts import get_open_food_facts

    stub = OffStub()
    stub.connect()
    yield stub
    del app.dependency_overrides[get_open_food_facts]
