import os
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import count
from pathlib import Path

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

PASSWORD = "correct horse battery"


def alembic_config() -> Config:
    return Config(Path(__file__).parent.parent / "alembic.ini")


def _sync_url(database: str | None = None) -> str:
    url = make_url(TEST_DATABASE_URL).set(drivername="postgresql")
    return (url.set(database=database) if database else url).render_as_string(hide_password=False)


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    """Пересоздаёт тестовую базу и накатывает миграции — тесты идут на реальном PostgreSQL."""
    name = make_url(TEST_DATABASE_URL).database
    if name is None or not name.endswith("_test"):
        raise RuntimeError(f"Тестовая база должна называться *_test, получено: {name!r}")
    with psycopg.connect(_sync_url("postgres"), autocommit=True) as conn:
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
    with psycopg.connect(_sync_url(), autocommit=True) as conn:
        conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(tables))


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def new_client() -> AsyncClient:
    from app.main import app

    # https: иначе httpx не вернёт серверу cookie с флагом Secure.
    return AsyncClient(transport=ASGITransport(app=app), base_url="https://test")


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with new_client() as client:
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
        from app.models import Language, Role, User
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
            await session.commit()
        token, _ = create_access_token(user.id)
        return Account(str(user.id), user.email, PASSWORD, {"Authorization": f"Bearer {token}"})

    return make
