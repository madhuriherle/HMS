"""Tiny in-process sliding-window rate limiter.

Limits are per-process (fine for the single-uvicorn deployment this project
uses today); if you scale to multiple workers, move this to Redis.
"""

import threading
import time
from typing import Dict, List


class SlidingWindowRateLimiter:
    def __init__(self, max_keys: int = 20_000) -> None:
        self._hits: Dict[str, List[float]] = {}
        self._lock = threading.Lock()
        self._max_keys = max_keys

    def check(self, key: str, max_hits: int, window_seconds: int) -> bool:
        """Record a hit for ``key``. Returns False when the limit is exceeded."""
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, ()) if now - t < window_seconds]
            if len(hits) >= max_hits:
                self._hits[key] = hits
                return False
            hits.append(now)
            if len(self._hits) >= self._max_keys:
                # Drop keys whose windows have fully elapsed.
                cutoff = now - window_seconds
                self._hits = {
                    k: v for k, v in self._hits.items() if v and v[-1] > cutoff
                }
            self._hits[key] = hits
            return True


rate_limiter = SlidingWindowRateLimiter()
