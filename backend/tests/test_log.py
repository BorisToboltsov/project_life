import json
import logging
import sys
from collections.abc import Iterator

import pytest

from app.log import JsonFormatter, configure_logging


@pytest.fixture
def restore_logging() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers, root.level = handlers, level


def record(message: str, **kwargs: object) -> logging.LogRecord:
    return logging.makeLogRecord(
        {"name": "app.test", "levelname": "INFO", "msg": message, **kwargs}
    )


def test_formatter_emits_one_json_object_per_record() -> None:
    entry = json.loads(JsonFormatter().format(record("вес сохранён")))

    assert entry["level"] == "INFO"
    assert entry["logger"] == "app.test"
    assert entry["message"] == "вес сохранён"
    assert entry["time"].endswith("+00:00")


def test_formatter_includes_traceback() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        entry = json.loads(JsonFormatter().format(record("failed", exc_info=sys.exc_info())))

    assert "ValueError: boom" in entry["exception"]


@pytest.mark.usefixtures("restore_logging")
def test_configure_logging_routes_uvicorn_through_root() -> None:
    logging.getLogger("uvicorn.access").addHandler(logging.NullHandler())

    configure_logging("WARNING")

    root = logging.getLogger()
    assert root.level == logging.WARNING
    assert [type(handler.formatter) for handler in root.handlers] == [JsonFormatter]
    assert logging.getLogger("uvicorn.access").handlers == []
    assert logging.getLogger("uvicorn.access").propagate
