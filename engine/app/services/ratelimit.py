"""Límite por clave con ventana deslizante, en memoria. Sirve para endpoints baratos y cacheados (clima) con una
sola réplica del motor; las corridas usan el límite atómico en Postgres (repo.create_run)."""
from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable


class SlidingWindow:
    MAX_KEYS = 10_000  # cada sesión anónima es una clave nueva: se purgan las inactivas para no crecer sin tope

    def __init__(self, limit: int, window_s: float, clock: Callable[[], float] = time.monotonic):
        self.limit, self.window, self.clock = limit, window_s, clock
        self.hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = self.clock()
        if len(self.hits) >= self.MAX_KEYS:
            self._purge(now)
        q = self.hits.setdefault(key, deque())
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def _purge(self, now: float) -> None:
        self.hits = {k: q for k, q in self.hits.items() if q and q[-1] > now - self.window}
