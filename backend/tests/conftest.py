import os
from collections.abc import AsyncIterator
from pathlib import Path

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from psycopg import sql
from sqlalchemy.engine import make_url

TEST_DATABASE_URL = os.environ.get(
    "LIFE_TEST_DATABASE_URL", "postgresql+psycopg://life:life@localhost:5433/life_test"
)
# Выставляется до первого импорта app.*: настройки и движок создаются при импорте.
os.environ["LIFE_ENVIRONMENT"] = "test"
os.environ["LIFE_DATABASE_URL"] = TEST_DATABASE_URL


def alembic_config() -> Config:
    return Config(Path(__file__).parent.parent / "alembic.ini")


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    """Пересоздаёт тестовую базу и накатывает миграции — тесты идут на реальном PostgreSQL."""
    url = make_url(TEST_DATABASE_URL)
    name = url.database
    if name is None or not name.endswith("_test"):
        raise RuntimeError(f"Тестовая база должна называться *_test, получено: {name!r}")
    admin_url = url.set(drivername="postgresql", database="postgres")
    with psycopg.connect(admin_url.render_as_string(hide_password=False), autocommit=True) as conn:
        conn.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
        )
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    command.upgrade(alembic_config(), "head")


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
