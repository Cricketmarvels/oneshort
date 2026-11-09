"""Expo push provider (tickets, receipts, invalid tokens), notification fan-out cleanup,
and paid-OTP abuse budgets (auth review H1)."""

import json
from typing import Any

import httpx
import pytest

from app.core.container import Container
from app.core.exceptions import AppError, RateLimited
from app.infrastructure.integrations.push import ExpoPushProvider, PushResult
from app.modules.auth.abuse import enforce_send_budgets
from app.modules.notifications.service import check_push_receipts

TOK_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
TOK_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"
NATIVE = "fcm-native-token-from-old-build"


def _transport(handler: Any) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


async def test_expo_provider_tickets_and_invalid_tokens() -> None:
    calls: list[Any] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body)
        tickets = []
        for msg in body:
            if msg["to"] == TOK_B:
                tickets.append({"status": "error", "message": "x", "details": {"error": "DeviceNotRegistered"}})
            else:
                tickets.append({"status": "ok", "id": "rcpt-1"})
        return httpx.Response(200, json={"data": tickets})

    p = ExpoPushProvider(transport=_transport(handler))
    res = await p.send([TOK_A, TOK_B, NATIVE], "T", "B", {"type": "player_invitation", "invitation_id": "i1"})
    assert res.accepted == 1
    assert set(res.invalid_tokens) == {TOK_B, NATIVE}  # native token never sent to Expo
    assert res.receipts == [("rcpt-1", TOK_A)]
    assert all(m["to"] != NATIVE for m in calls[0])
    assert calls[0][0]["data"]["invitation_id"] == "i1"


async def test_expo_provider_retries_transient_failure() -> None:
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "r2"}]})

    p = ExpoPushProvider(transport=_transport(handler))
    res = await p.send([TOK_A], "T", "B", {})
    assert attempts["n"] == 2 and res.accepted == 1


async def test_receipt_check_deletes_dead_tokens(container: Container) -> None:
    from datetime import timedelta

    from app.common.types import utcnow

    db = container.mongo
    await db["devices"].update_one(
        {"push_token": TOK_B}, {"$set": {"user_id": None, "platform": "android"}}, upsert=True
    )
    old = utcnow() - timedelta(minutes=20)
    await db["push_receipts"].insert_one({"receipt_id": "rc-dead", "push_token": TOK_B, "created_at": old})

    class FakeExpo:
        configured = True

        async def send(self, *a: Any, **k: Any) -> PushResult:
            return PushResult()

        async def get_receipts(self, ids: list[str]) -> dict[str, tuple[str, str | None]]:
            return {"rc-dead": ("error", "DeviceNotRegistered")}

    original = container.push
    container.push = FakeExpo()  # type: ignore[assignment]
    try:
        n = await check_push_receipts(container)
    finally:
        container.push = original
    assert n == 1
    assert await db["devices"].count_documents({"push_token": TOK_B}) == 0
    assert await db["push_receipts"].count_documents({"receipt_id": "rc-dead"}) == 0


class _PaidSender:
    exposes_code = False

    async def send(self, mobile: str, code: str) -> None:  # pragma: no cover - never reached in these tests
        return None


async def test_otp_budgets_apply_only_to_paid_senders(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    # Free (console) sender: no restrictions, any region
    await enforce_send_budgets(container, "+447700900950", "1.2.3.4", "sms")

    monkeypatch.setattr(container, "otp_sender", _PaidSender())
    pinned = container.settings.model_copy(
        update={"otp_max_sends_per_day": 10, "otp_ip_max_sends_per_hour": 20, "otp_daily_budget": 1_000_000}
    )
    monkeypatch.setattr(container, "settings", pinned)
    # Region allowlist (default +91 only)
    with pytest.raises(AppError) as e:
        await enforce_send_budgets(container, "+447700900950", "1.2.3.4", "sms")
    assert e.value.code == "OTP_REGION_UNSUPPORTED"
    await enforce_send_budgets(container, "+919812345001", "1.2.3.4", "sms")  # allowed

    from datetime import timedelta

    from app.common.types import utcnow

    now = utcnow()
    logs = container.mongo["otp_codes"]
    # per-number daily cap
    await logs.insert_many(
        [
            {
                "kind": "send_log",
                "mobile_number": "+919812345002",
                "ip": "9.9.9.9",
                "created_at": now - timedelta(hours=h),
            }
            for h in range(10)
        ]
    )
    with pytest.raises(RateLimited):
        await enforce_send_budgets(container, "+919812345002", "5.5.5.5", "sms")
    # per-IP hourly cap
    await logs.insert_many(
        [
            {"kind": "send_log", "mobile_number": f"+9198123451{i:02d}", "ip": "8.8.4.4", "created_at": now}
            for i in range(20)
        ]
    )
    with pytest.raises(RateLimited):
        await enforce_send_budgets(container, "+919812345003", "8.8.4.4", "sms")
    # global daily budget
    tight = pinned.model_copy(update={"otp_daily_budget": 5})
    monkeypatch.setattr(container, "settings", tight)
    with pytest.raises(RateLimited) as e2:
        await enforce_send_budgets(container, "+919812345004", "7.7.7.7", "sms")
    assert e2.value.code == "OTP_BUDGET_EXHAUSTED"
