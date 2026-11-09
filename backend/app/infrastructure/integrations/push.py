"""Push notification providers.

Default architecture (docs/design/PUSH_NOTIFICATIONS.md): the app registers an **Expo push token**
(`ExponentPushToken[...]`) and the backend delivers through the Expo Push Service, which fans out to FCM
(Android) and APNs (iOS) using credentials held in the EAS project. Delivery is verified in two steps, as
Expo requires: the send call returns *tickets* (accepted/foreseeable errors) and later *receipts* confirm
hand-off to FCM/APNs. ``DeviceNotRegistered`` at either step means the token must be deleted.

A direct-FCM adapter remains for a future move off Expo's service; it is explicitly unimplemented until
service-account credentials exist. Nothing here ever claims delivery that was not confirmed.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("push")

EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
_BATCH = 100


@dataclass
class PushResult:
    """Outcome of a send: tokens to forget, and ticket ids to check for receipts later."""

    invalid_tokens: list[str] = field(default_factory=list)
    receipts: list[tuple[str, str]] = field(default_factory=list)  # (receipt_id, token)
    accepted: int = 0


def is_expo_token(token: str) -> bool:
    return token.startswith(("ExponentPushToken[", "ExpoPushToken[")) and token.endswith("]")


class PushProvider(Protocol):
    configured: bool

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> PushResult: ...


class NullPushProvider:
    """DEVELOPMENT ADAPTER: push disabled. In-app notifications still work."""

    configured = False

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> PushResult:
        if tokens:
            log.debug("push.skipped_unconfigured", count=len(tokens))
        return PushResult()


class ExpoPushProvider:
    """Expo Push Service (exp.host). No server credentials needed here: FCM/APNs keys live in the EAS
    project. An optional access token is sent when push security is enabled on the Expo account."""

    configured = True

    def __init__(self, access_token: str | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._headers = {"accept": "application/json", "content-type": "application/json"}
        if access_token:
            self._headers["authorization"] = f"Bearer {access_token}"
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=15, headers=self._headers, transport=self._transport)

    async def _post(self, client: httpx.AsyncClient, url: str, payload: Any) -> Any:
        """POST with one retry on transient failures (429/5xx/network)."""
        for attempt in (1, 2):
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code in (429, 500, 502, 503, 504) and attempt == 1:
                    await asyncio.sleep(1.0)
                    continue
                resp.raise_for_status()
                return resp.json()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                if attempt == 2:
                    raise
                log.warning("push.expo.retry", error=type(exc).__name__)
                await asyncio.sleep(1.0)
        raise AssertionError("unreachable")

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> PushResult:
        result = PushResult()
        expo_tokens: list[str] = []
        for t in dict.fromkeys(tokens):
            # Native FCM/APNs tokens from older app builds can't be delivered through this provider.
            (expo_tokens if is_expo_token(t) else result.invalid_tokens).append(t)
        if not expo_tokens:
            return result
        async with self._client() as client:
            for i in range(0, len(expo_tokens), _BATCH):
                batch = expo_tokens[i : i + _BATCH]
                messages = [
                    {
                        "to": t,
                        "title": title,
                        "body": body,
                        "data": data,
                        "sound": "default",
                        "channelId": "default",
                        "priority": "high",
                    }
                    for t in batch
                ]
                try:
                    out = await self._post(client, EXPO_SEND_URL, messages)
                except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                    # Batch failed outright: tokens stay registered; the in-app inbox already has the event.
                    log.warning("push.expo.batch_failed", count=len(batch), error=type(exc).__name__)
                    continue
                tickets = out.get("data") or []
                for token, ticket in zip(batch, tickets, strict=False):
                    if ticket.get("status") == "ok":
                        result.accepted += 1
                        if ticket.get("id"):
                            result.receipts.append((ticket["id"], token))
                    else:
                        err = ((ticket.get("details") or {}).get("error")) or "unknown"
                        if err == "DeviceNotRegistered":
                            result.invalid_tokens.append(token)
                        log.warning("push.expo.ticket_error", error=err)
        return result

    async def get_receipts(self, receipt_ids: list[str]) -> dict[str, tuple[str, str | None]]:
        """receipt_id -> (status, error). Only ids Expo has finished processing are returned."""
        out: dict[str, tuple[str, str | None]] = {}
        async with self._client() as client:
            for i in range(0, len(receipt_ids), 300):
                chunk = receipt_ids[i : i + 300]
                try:
                    data = (await self._post(client, EXPO_RECEIPTS_URL, {"ids": chunk})).get("data") or {}
                except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                    log.warning("push.expo.receipts_failed", error=type(exc).__name__)
                    continue
                for rid, rec in data.items():
                    out[rid] = (rec.get("status", "unknown"), (rec.get("details") or {}).get("error"))
        return out


class FcmPushProvider:
    """Direct FCM HTTP v1 adapter. UNCONFIGURED: requires FCM_PROJECT_ID and a service account.
    Covers Android only — iOS needs APNs credentials, which the Expo Push Service path manages instead."""

    configured = True

    def __init__(self, project_id: str, service_account_json: str) -> None:
        self.project_id = project_id
        self.service_account_json = service_account_json

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> PushResult:
        raise NotImplementedError("FCM adapter requires service-account credentials to be configured")


def build_push_provider(settings: Settings) -> PushProvider:
    if settings.push_provider == "expo":
        return ExpoPushProvider(settings.expo_push_access_token)
    if settings.push_provider == "fcm" and settings.fcm_project_id and settings.fcm_service_account_json:
        return FcmPushProvider(settings.fcm_project_id, settings.fcm_service_account_json)
    return NullPushProvider()


def stringify(data: dict[str, Any]) -> dict[str, str]:
    return {k: str(v) for k, v in data.items() if v is not None}
