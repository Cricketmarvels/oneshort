"""Per-process candidate cache for the search service (20 s TTL, 512 entries).

Absorbs keystroke bursts. Any index write clears it, so a renamed player or a new team shows up on the next
keystroke; with several API instances the others converge within the TTL.
"""

import time
from typing import Any

_TTL = 20.0
_MAX = 512
Key = tuple[str, tuple[str, ...]]


class CandidateCache:
    def __init__(self) -> None:
        self._d: dict[Key, tuple[float, list[dict[str, Any]]]] = {}

    def get(self, key: Key) -> list[dict[str, Any]] | None:
        hit = self._d.get(key)
        if hit and time.monotonic() - hit[0] < _TTL:
            return hit[1]
        return None

    def put(self, key: Key, rows: list[dict[str, Any]]) -> None:
        if len(self._d) >= _MAX:
            self._d.pop(next(iter(self._d)))
        self._d[key] = (time.monotonic(), rows)

    def clear(self) -> None:
        self._d.clear()


candidate_cache = CandidateCache()
