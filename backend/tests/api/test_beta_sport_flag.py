"""PLAYR_BETA_SPORT: a single-sport release hides the other sports without deleting anything."""

import httpx
import pytest
from bson import ObjectId

from app.core.config import Settings
from app.core.container import Container
from tests.conftest import register

API = "/api/v1"


@pytest.fixture
def cricket_beta(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(container, "settings", container.settings.model_copy(update={"playr_beta_sport": "cricket"}))


async def test_flag_is_public_and_racket_apis_disappear(client: httpx.AsyncClient, cricket_beta: None) -> None:
    opts = (await client.get(f"{API}/auth/options")).json()["data"]
    assert opts["beta_sport"] == "cricket"
    u = await register(client, "Beta Only")
    for path in ("/racket/badminton/profile/me", "/racket/pickleball/profile/me", "/racket/requests"):
        r = await client.get(f"{API}{path}", headers=u.h)
        assert r.status_code == 404 and r.json()["error"]["code"] == "SPORT_NOT_AVAILABLE", path
    r = await client.put(
        f"{API}/racket/badminton/me",
        headers=u.h,
        json={"level": "beginner", "formats": [], "preferred_times": [], "availability": [], "discoverable": True},
    )
    assert r.status_code == 404  # cannot create hidden-sport data


async def test_profiles_read_as_the_beta_sport_and_cannot_switch_away(
    client: httpx.AsyncClient, container: Container, cricket_beta: None
) -> None:
    u = await register(client, "Beta Switcher")
    # a profile that chose badminton before the beta is shown cricket, with the stored value untouched
    await container.mongo["users"].update_one({"_id": ObjectId(u.id)}, {"$set": {"preferred_sport": "badminton"}})
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    assert me["preferred_sport"] == "cricket"
    assert (await container.mongo["users"].find_one({"_id": ObjectId(u.id)}))["preferred_sport"] == "badminton"
    r = await client.put(f"{API}/users/me", headers=u.h, json={"preferred_sport": "pickleball"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "SPORT_NOT_AVAILABLE"
    assert (await client.put(f"{API}/users/me", headers=u.h, json={"preferred_sport": "cricket"})).status_code == 200


async def test_without_the_flag_every_sport_works(client: httpx.AsyncClient) -> None:
    u = await register(client, "All Sports")
    assert (await client.get(f"{API}/auth/options")).json()["data"]["beta_sport"] is None
    assert (await client.get(f"{API}/racket/badminton/profile/me", headers=u.h)).status_code == 200
    assert (await client.put(f"{API}/users/me", headers=u.h, json={"preferred_sport": "badminton"})).status_code == 200


def test_beta_environment_has_production_guards() -> None:
    with pytest.raises(ValueError, match="OTP_PROVIDER=console is not allowed"):
        Settings(
            app_env="beta",
            jwt_secret="x" * 40,
            whatsapp_provider="meta",
            debug=False,
            legal_entity_name="a",
            legal_entity_address="b",
            grievance_officer_name="c",
            grievance_email="d@e.in",
        )
    with pytest.raises(ValueError, match="TESTER_SIGNUP_PREFIX"):
        Settings(
            app_env="beta",
            jwt_secret="x" * 40,
            otp_provider="msg91",
            whatsapp_provider="meta",
            debug=False,
            tester_signup_prefix="+447700900",
            legal_entity_name="a",
            legal_entity_address="b",
            grievance_officer_name="c",
            grievance_email="d@e.in",
        )
