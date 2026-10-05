import pytest
from sqlalchemy.pool import NullPool

from app import db
from app.config import Settings


def test_test_environment_does_not_pool_connections() -> None:
    assert isinstance(db.engine.pool, NullPool)


def test_other_environments_pool_connections(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "get_settings", lambda: Settings(environment="dev"))

    engine = db.create_engine()

    assert not isinstance(engine.pool, NullPool)
