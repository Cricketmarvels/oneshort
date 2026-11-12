"""Test fixtures. Integration tests run against a real MongoDB replica set
(``TEST_MONGODB_URI``, default the local dev RS on 27018) using a dedicated database."""

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from app.core.config import Settings
from app.core.container import Container, build_container
from app.main import create_app

TEST_DB = os.environ.get("TEST_MONGODB_DB", "cricket_test")


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        app_env="test",
        mongodb_uri=os.environ.get("TEST_MONGODB_URI", "mongodb://127.0.0.1:27018/?replicaSet=rs0"),
        mongodb_db=TEST_DB,
        gofindr_beta_sport=None,  # tests cover every sport; the developer's .env may run a single-sport beta
        tester_signup_prefix=None,
        otp_daily_budget=1_000_000,  # the whole suite shares one 24h window; budget logic is tested explicitly
        otp_ip_max_sends_per_hour=1_000_000,  # the ASGI test client shares one IP
        scheduler_enabled=False,
        rate_limit_auth_per_minute=100_000,
        rate_limit_default_per_minute=100_000,
        otp_resend_cooldown_seconds=0,
        dev_otp_in_response=True,
        debug=False,
        otp_max_sends_per_hour=1000,
        jwt_secret="test-secret-test-secret-test-secret-123",
        local_upload_dir="/tmp/cricket-test-uploads",
        log_level="WARNING",
        # Never reach real providers from tests, whatever backend/.env says.
        otp_provider="console",
        whatsapp_provider="none",
        push_provider="none",
        email_otp_enabled=True,  # the deferred email-code feature keeps its own tests; off by default in .env
        email_provider="console",
    )


@pytest.fixture(scope="session")
async def container(settings: Settings) -> AsyncIterator[Container]:
    c = build_container(settings)
    await c.mongo.client.drop_database(TEST_DB)
    yield c


@pytest.fixture(scope="session")
async def app(settings: Settings, container: Container) -> AsyncIterator[FastAPI]:
    application = create_app(settings, container)
    async with LifespanManager(application):
        yield application


@pytest.fixture(scope="session")
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ------------------------------------------------------------------ helpers
_counter = iter(range(1_000_000))


def unique_mobile() -> str:
    return f"+9198{next(_counter):08d}"


@dataclass
class TestUser:
    id: str
    token: str
    refresh: str
    mobile: str
    name: str

    @property
    def h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def register(
    client: httpx.AsyncClient,
    name: str = "Rohit Test",
    *,
    agree: bool = True,
    city: str = "Bengaluru",
    password: str | None = None,
) -> TestUser:
    mobile = unique_mobile()
    email = f"{mobile[1:]}@example.com"
    body: dict[str, Any] = {"full_name": name, "mobile_number": mobile, "email": email, "city": city}
    if password:
        body["password"] = password
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 201, r.text
    code = r.json()["data"]["otp"]["dev_otp"]
    profile = {k: v for k, v in body.items() if k in ("full_name", "email", "city", "password")}
    r = await client.post(
        "/api/v1/auth/verify-otp",
        json={"mobile_number": mobile, "code": code, "purpose": "register", "profile": profile},
    )
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    user = TestUser(d["user"]["id"], d["access_token"], d["refresh_token"], mobile, name)
    r = await client.post(
        "/api/v1/users/me/registration",
        headers=user.h,
        json={"full_name": name, "email": email, "play_as": "player"},
    )
    assert r.status_code == 200, r.text
    if agree:
        cur = (await client.get("/api/v1/agreements/current")).json()["data"]["version"]
        r = await client.post(
            "/api/v1/agreements/acceptance",
            headers=user.h,
            json={"version": cur, "accepted": True, "age_confirmed": True, "privacy_acknowledged": True},
        )
        assert r.status_code == 200, r.text
    return user


# Bengaluru reference points (lat, lng)
KORAMANGALA = (12.9352, 77.6245)
HSR_LAYOUT = (12.9116, 77.6474)  # ~3.5 km from Koramangala
WHITEFIELD = (12.9698, 77.7500)  # ~14 km from Koramangala
YELAHANKA = (13.1007, 77.5963)  # ~19 km from Koramangala
MYSURU = (12.2958, 76.6394)  # ~130 km


async def make_player(
    client: httpx.AsyncClient, name: str, role: str, at: tuple[float, float], secondary: list[str] | None = None
) -> TestUser:
    u = await register(client, name)
    r = await client.put(
        "/api/v1/players/me",
        headers=u.h,
        json={
            "primary_role": role,
            "secondary_roles": secondary or [],
            "home_location": {"lat": at[0], "lng": at[1]},
        },
    )
    assert r.status_code == 200, r.text
    return u


def future(days: int = 3, hour: int = 7) -> datetime:
    base = (datetime.now(UTC) + timedelta(days=days)).replace(hour=hour - 5, minute=30, second=0, microsecond=0)
    return base  # 07:00 IST expressed in UTC


def iso(dt: datetime) -> str:
    return dt.isoformat()


async def make_team(
    client: httpx.AsyncClient,
    captain: TestUser,
    name: str = "Koramangala Kings",
    at: tuple[float, float] = KORAMANGALA,
    category: str = "friendly",
) -> str:
    r = await client.post(
        "/api/v1/teams",
        headers=captain.h,
        json={
            "team_name": name,
            "location": {"lat": at[0], "lng": at[1]},
            "area": "Koramangala",
            "city": "Bengaluru",
            "category": category,
        },
    )
    assert r.status_code == 201, r.text
    return str(r.json()["data"]["id"])


async def make_match(
    client: httpx.AsyncClient,
    captain: TestUser,
    team_id: str,
    *,
    start: datetime | None = None,
    hours: int = 3,
    at: tuple[float, float] = KORAMANGALA,
    capacity: int = 11,
    roles: dict[str, int] | None = None,
    expenses: int = 400000,
    captain_plays: bool = True,
    fmt: str = "T20",
    category: str = "friendly",
) -> dict[str, Any]:
    start = start or future()
    r = await client.post(
        "/api/v1/matches",
        headers=captain.h,
        json={
            "team_id": team_id,
            "title": "Sunday T20",
            "venue": {
                "name": "Jyoti Nivas College Ground",
                "address": "Hosur Rd, Koramangala",
                "area": "Koramangala",
                "city": "Bengaluru",
            },
            "location": {"lat": at[0], "lng": at[1]},
            "start_at": iso(start),
            "end_at": iso(start + timedelta(hours=hours)),
            "format": fmt,
            "category": category,
            "squad_capacity": capacity,
            "required_roles": roles or {},
            "estimated_expenses_paise": expenses,
            "captain_plays": captain_plays,
        },
    )
    assert r.status_code == 201, r.text
    return dict(r.json()["data"])


async def add_slot(
    client: httpx.AsyncClient,
    user: TestUser,
    start: datetime,
    hours: float = 4,
    status: str = "available",
    at: tuple[float, float] | None = None,
    max_travel_km: int = 20,
    contribution: str | None = None,
) -> httpx.Response:
    body: dict[str, Any] = {
        "start_at": iso(start),
        "end_at": iso(start + timedelta(hours=hours)),
        "status": status,
        "max_travel_km": max_travel_km,
    }
    if contribution:
        body["contribution"] = contribution
    if at:
        body["location"] = {"lat": at[0], "lng": at[1]}
    return await client.post("/api/v1/availability", headers=user.h, json=body)
