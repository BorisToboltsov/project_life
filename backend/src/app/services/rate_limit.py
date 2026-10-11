"""Ограничение частоты в памяти процесса: не больше стольких-то событий за окно.

Счёт не переживает перезапуск и ведётся отдельно в каждом процессе — этого достаточно
там, где предел бережёт чужой сервис, а не свои данные (ADR 0009).
"""

import time
from collections import defaultdict, deque
from collections.abc import Hashable
from datetime import timedelta


class SlidingWindow:
    def __init__(self, limit: int, window: timedelta) -> None:
        self._limit = limit
        self._window = window.total_seconds()
        self._events: defaultdict[Hashable, deque[float]] = defaultdict(deque)

    def allow(self, key: Hashable = None) -> bool:
        """Засчитывает событие; `False` — предел исчерпан, событие не засчитано."""
        now = time.monotonic()
        events = self._events[key]
        while events and events[0] <= now - self._window:
            events.popleft()
        if len(events) >= self._limit:
            return False
        events.append(now)
        return True
