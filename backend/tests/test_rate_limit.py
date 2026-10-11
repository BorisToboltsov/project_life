from datetime import timedelta

import pytest

from app.services import rate_limit
from app.services.rate_limit import SlidingWindow


def test_limit_is_counted_per_key_within_the_window(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])
    window = SlidingWindow(2, timedelta(minutes=1))

    assert window.allow("anna")
    clock[0] += 30
    assert window.allow("anna")
    assert not window.allow("anna")
    # У другого ключа свой счёт.
    assert window.allow("boris")

    # Первое событие вышло из окна — место одно: отказ выше засчитан не был.
    clock[0] += 30
    assert window.allow("anna")
    assert not window.allow("anna")
