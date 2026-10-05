from collections.abc import AsyncIterator

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app import __version__
from app.db import get_session
from app.main import app

pytestmark = pytest.mark.anyio


async def test_health_reports_version(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


async def test_health_is_503_when_database_is_down(client: AsyncClient) -> None:
    # Порт 1 закрыт: соединение отклоняется сразу, как при упавшей базе.
    dead_engine = create_async_engine(
        "postgresql+psycopg://life:life@127.0.0.1:1/life", poolclass=NullPool
    )

    async def dead_session() -> AsyncIterator[AsyncSession]:
        async with AsyncSession(dead_engine) as session:
            yield session

    app.dependency_overrides[get_session] = dead_session
    try:
        response = await client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
