"""Real-time event hub over native WebSockets.

``InProcessHub`` works for a single API instance. For horizontal scaling, implement
``RealtimeHub`` on Redis pub/sub without touching callers.
"""

import asyncio
from collections import defaultdict
from typing import Any, Protocol

from fastapi import WebSocket

from app.core.logging import get_logger

log = get_logger("realtime")


class RealtimeHub(Protocol):
    async def connect(self, user_id: str, ws: WebSocket) -> None: ...
    def disconnect(self, user_id: str, ws: WebSocket) -> None: ...
    async def publish(self, user_ids: list[str], event: str, payload: dict[str, Any]) -> None: ...


class InProcessHub:
    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        self._conns[user_id].add(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        self._conns[user_id].discard(ws)
        if not self._conns[user_id]:
            self._conns.pop(user_id, None)

    async def publish(self, user_ids: list[str], event: str, payload: dict[str, Any]) -> None:
        message = {"event": event, "payload": payload}
        targets = [(uid, ws) for uid in set(user_ids) for ws in list(self._conns.get(uid, ()))]
        if not targets:
            return
        results = await asyncio.gather(*(ws.send_json(message) for _, ws in targets), return_exceptions=True)
        for (uid, ws), res in zip(targets, results, strict=True):
            if isinstance(res, Exception):
                self.disconnect(uid, ws)
