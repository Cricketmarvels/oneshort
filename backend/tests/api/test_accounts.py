"""Email + password sign-up, Google sign-in, account linking and the profile fields (DOB, playing roles)."""

from dataclasses import dataclass
from datetime import date

import httpx

from app.core.container import Container
from app.core.exceptions import Unauthorized
from app.infrastructure.integrations.google import GoogleIdentity, identity_from_claims
from tests.conftest import register, unique_mobile

API = "/api/v1"
DOB = date(1995, 6, 15).isoformat()


def form(**over: object) -> dict[str, object]:
    m = unique_mobile()
    return {
        "full_name": "Priya Nair",
        "date_of_birth": DOB,
        "email": f"p{m[1:]}@example.in",
        "password": "LongerPass2026!",
        "confirm_password": "LongerPass2026!",
        "playing_roles": ["batsman", "wicketkeeper"],
        **over,
    }


@dataclass
class FakeGoogle:
    """Stands in for Google's signature check: a token is "g:<sub>:<email>[:unverified]"."""

    configured: bool = True
    name: str | None = "Google User"

    def verify(self, token: str) -> GoogleIdentity:
        if not token.startswith("g:"):
            raise Unauthorized("Google sign-in couldn't be verified. Try again.", code="GOOGLE_TOKEN_INVALID")
        parts = token.split(":")
        return GoogleIdentity(
            sub=parts[1], email=parts[2].lower(), email_verified="unverified" not in parts, name=self.name, picture=None
        )


# ------------------------------------------------------------------ email + password
async def test_email_register_creates_a_complete_account_and_logs_in(
    client: httpx.AsyncClient, container: Container
) -> None:
    f = form()
    r = await client.post(f"{API}/auth/register/email", json=f)
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    u = d["user"]
    assert d["is_new_user"] is True and d["access_token"] and d["refresh_token"]
    assert u["full_name"] == "Priya Nair" and u["date_of_birth"] == DOB
    assert u["playing_roles"] == ["batsman", "wicketkeeper"] and u["auth_providers"] == ["password"]
    assert u["onboarding_completed"] is True and u["registration_completed_at"] is not None
    assert u["email_verified"] is False and u["phone_verified"] is False and u["has_password"] is True
    # the password is stored only as an Argon2id hash; the confirmation is not stored at all
    doc = await container.mongo["users"].find_one({"email": f["email"]})
    assert doc is not None and doc["password_hash"].startswith("$argon2id$") and "confirm_password" not in doc
    assert "LongerPass2026!" not in str(doc)
    # discovery profile seeded from the roles
    prof = await container.mongo["player_profiles"].find_one({"user_id": doc["_id"]})
    assert prof is not None and prof["primary_role"] == "batsman" and prof["secondary_roles"] == ["wicketkeeper"]
    # and the password works for login
    r = await client.post(f"{API}/auth/login", json={"email": f["email"], "password": f["password"]})
    assert r.status_code == 200, r.text


async def test_email_register_rejects_duplicates_weak_passwords_and_bad_profiles(client: httpx.AsyncClient) -> None:
    f = form()
    assert (await client.post(f"{API}/auth/register/email", json=f)).status_code == 201
    dup = await client.post(f"{API}/auth/register/email", json=form(email=f["email"]))
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ACCOUNT_EXISTS"
    # same address, different case
    dup2 = await client.post(f"{API}/auth/register/email", json=form(email=str(f["email"]).upper()))
    assert dup2.status_code == 409
    for bad in (
        {"password": "Short1", "confirm_password": "Short1"},  # < 12
        {"password": "alllettersnodigits", "confirm_password": "alllettersnodigits"},
        {"confirm_password": "Different2026!"},
        {"date_of_birth": date.today().replace(year=date.today().year - 15).isoformat()},  # under 18
        {"date_of_birth": "1890-01-01"},
        {"playing_roles": []},
        {"playing_roles": ["batsman", "batsman"]},
        {"playing_roles": ["goalkeeper"]},
        {"full_name": "P"},
        {"email": "not-an-email"},
    ):
        r = await client.post(f"{API}/auth/register/email", json=form(**bad))
        assert r.status_code == 422, (bad, r.text)


# ------------------------------------------------------------------ google
async def test_google_sign_in_creates_then_reopens_the_same_account(
    client: httpx.AsyncClient, container: Container
) -> None:
    container.google = FakeGoogle()
    opts = (await client.get(f"{API}/auth/options")).json()["data"]
    assert opts["google"] is True
    r = await client.post(f"{API}/auth/google", json={"id_token": "g:sub-1001:New.Person@example.in"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    u = d["user"]
    assert d["is_new_user"] is True
    assert u["email"] == "new.person@example.in" and u["email_verified"] is True
    assert u["auth_providers"] == ["google"] and u["has_password"] is False
    assert u["registration_completed_at"] is None  # DOB + roles still to come
    doc = await container.mongo["users"].find_one({"google_sub": "sub-1001"})
    assert doc is not None and doc["password_hash"] is None
    # second sign-in: same account, not new, no second document
    r = await client.post(f"{API}/auth/google", json={"id_token": "g:sub-1001:new.person@example.in"})
    assert r.status_code == 200 and r.json()["data"]["is_new_user"] is False
    assert r.json()["data"]["user"]["id"] == u["id"]
    assert await container.mongo["users"].count_documents({"email": "new.person@example.in"}) == 1
    # Google users complete their profile with DOB + roles; they are never asked for a password
    h = {"Authorization": f"Bearer {d['access_token']}"}
    r = await client.post(
        f"{API}/users/me/registration",
        headers=h,
        json={
            "full_name": "New Person",
            "email": "new.person@example.in",
            "play_as": "player",
            "date_of_birth": DOB,
            "playing_roles": ["all_rounder", "bowler"],
        },
    )
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert me["onboarding_completed"] is True and me["playing_roles"] == ["all_rounder", "bowler"]
    assert me["has_password"] is False and me["email_verified"] is True


async def test_google_rejects_bad_tokens_and_is_off_when_unconfigured(
    client: httpx.AsyncClient, container: Container
) -> None:
    container.google = FakeGoogle()
    before = await container.mongo["users"].count_documents({"auth_providers": "google"})
    r = await client.post(f"{API}/auth/google", json={"id_token": "x" * 40})
    assert r.status_code == 401 and r.json()["error"]["code"] == "GOOGLE_TOKEN_INVALID"
    assert await container.mongo["users"].count_documents({"auth_providers": "google"}) == before
    from app.infrastructure.integrations.google import DisabledGoogle

    container.google = DisabledGoogle()
    assert (await client.get(f"{API}/auth/options")).json()["data"]["google"] is False
    r = await client.post(f"{API}/auth/google", json={"id_token": "g:sub-1:someone@example.in"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "GOOGLE_UNAVAILABLE"


def test_google_claims_are_checked_for_issuer_and_subject() -> None:
    ok = identity_from_claims(
        {"iss": "https://accounts.google.com", "sub": "1", "email": "A@B.in", "email_verified": True}
    )
    assert ok.email == "a@b.in" and ok.email_verified is True
    for bad in ({"iss": "https://evil.example", "sub": "1"}, {"iss": "accounts.google.com"}):
        try:
            identity_from_claims(bad)
        except Unauthorized as exc:
            assert exc.code == "GOOGLE_TOKEN_INVALID"
        else:
            raise AssertionError("accepted bad claims")


async def test_google_never_merges_into_an_account_whose_email_is_unverified(
    client: httpx.AsyncClient, container: Container
) -> None:
    container.google = FakeGoogle()
    # phone sign-up typed this email; it was never proven
    u = await register(client, "Rahul Owner")
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    assert me["email_verified"] is False
    r = await client.post(f"{API}/auth/google", json={"id_token": f"g:sub-2002:{me['email']}"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ACCOUNT_EXISTS_UNLINKED"
    assert await container.mongo["users"].count_documents({"google_sub": "sub-2002"}) == 0
    # the owner links it from inside their session
    r = await client.post(f"{API}/auth/google/link", headers=u.h, json={"id_token": f"g:sub-2002:{me['email']}"})
    assert r.status_code == 200, r.text
    linked = r.json()["data"]
    assert "google" in linked["auth_providers"] and linked["email_verified"] is True  # Google proved the address
    # now Google sign-in opens the owner's account
    r = await client.post(f"{API}/auth/google", json={"id_token": f"g:sub-2002:{me['email']}"})
    assert r.status_code == 200 and r.json()["data"]["user"]["id"] == u.id
    # and that Google identity can't be linked to a second account
    other = await register(client, "Someone Else")
    r = await client.post(f"{API}/auth/google/link", headers=other.h, json={"id_token": f"g:sub-2002:{me['email']}"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "GOOGLE_IN_USE"


async def test_google_links_automatically_only_when_both_sides_verified_the_email(
    client: httpx.AsyncClient, container: Container
) -> None:
    container.google = FakeGoogle()
    f = form()
    t = (await client.post(f"{API}/auth/register/email", json=f)).json()["data"]
    uid = t["user"]["id"]
    # our side unverified → refused
    r = await client.post(f"{API}/auth/google", json={"id_token": f"g:sub-3003:{f['email']}"})
    assert r.status_code == 409
    # mark verified on our side (as the email-code flow would) but Google says unverified → still refused
    from bson import ObjectId

    await container.mongo["users"].update_one({"_id": ObjectId(uid)}, {"$set": {"email_verified": True}})
    r = await client.post(f"{API}/auth/google", json={"id_token": f"g:sub-3003:{f['email']}:unverified"})
    assert r.status_code == 409
    # both verified → linked, same account, password kept
    r = await client.post(f"{API}/auth/google", json={"id_token": f"g:sub-3003:{f['email']}"})
    assert r.status_code == 200, r.text
    u = r.json()["data"]["user"]
    assert u["id"] == uid and sorted(u["auth_providers"]) == ["google", "password"] and u["has_password"] is True


async def test_google_account_cannot_log_in_with_a_password(client: httpx.AsyncClient, container: Container) -> None:
    container.google = FakeGoogle()
    await client.post(f"{API}/auth/google", json={"id_token": "g:sub-4004:nopass@example.in"})
    r = await client.post(f"{API}/auth/login", json={"email": "nopass@example.in", "password": "Whatever12345"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"


# ------------------------------------------------------------------ profile + protection
async def test_profile_patch_updates_fields_and_discovery_roles(
    client: httpx.AsyncClient, container: Container
) -> None:
    f = form()
    t = (await client.post(f"{API}/auth/register/email", json=f)).json()["data"]
    h = {"Authorization": f"Bearer {t['access_token']}"}
    r = await client.patch(
        f"{API}/users/me/profile", headers=h, json={"player_name": "Priya N", "playing_roles": ["bowler"]}
    )
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert me["full_name"] == "Priya N" and me["playing_roles"] == ["bowler"] and me["date_of_birth"] == DOB
    prof = await container.mongo["player_profiles"].find_one({"user_id": __import__("bson").ObjectId(me["id"])})
    assert prof is not None and prof["primary_role"] == "bowler" and prof["secondary_roles"] == []
    for bad in ({"date_of_birth": "2020-01-01"}, {"playing_roles": []}, {"email_verified": True}, {"player_name": "x"}):
        assert (await client.patch(f"{API}/users/me/profile", headers=h, json=bad)).status_code == 422, bad
    assert (await client.patch(f"{API}/users/me/profile", json={"player_name": "Nobody Here"})).status_code == 401


async def test_sessions_refresh_rotation_and_logout_for_password_accounts(client: httpx.AsyncClient) -> None:
    t = (await client.post(f"{API}/auth/register/email", json=form())).json()["data"]
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": t["refresh_token"]})
    assert r.status_code == 200
    t2 = r.json()["data"]
    assert t2["refresh_token"] != t["refresh_token"]
    # logout revokes the family: neither token refreshes afterwards
    assert (await client.post(f"{API}/auth/logout", json={"refresh_token": t2["refresh_token"]})).status_code == 204
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": t2["refresh_token"]})).status_code == 401
    assert (await client.get(f"{API}/users/me", headers={"Authorization": "Bearer not-a-token"})).status_code == 401


# ------------------------------------------------------------------ player vs captain features
async def test_players_only_get_player_features_and_captains_both(client: httpx.AsyncClient) -> None:
    player = (await client.post(f"{API}/auth/register/email", json=form())).json()["data"]
    assert "captain" not in player["user"]["roles"]  # the default is a player account
    ph = {"Authorization": f"Bearer {player['access_token']}"}
    cur = (await client.get(f"{API}/agreements/current")).json()["data"]["version"]
    accept = {"version": cur, "accepted": True, "age_confirmed": True, "privacy_acknowledged": True}
    assert (await client.post(f"{API}/agreements/acceptance", headers=ph, json=accept)).status_code == 200
    team = {"team_name": "Copycats", "location": {"lat": 28.57, "lng": 77.32}, "area": "Sector 18", "city": "Noida"}
    for method, path, body in (
        ("POST", "/teams", team),
        ("PUT", "/captains/me", {"bio": "x"}),
        ("POST", "/challenges", {}),
        ("POST", "/matches", {}),
        ("POST", "/matches/000000000000000000000000/invite-link", None),
    ):
        r = await client.request(method, f"{API}{path}", headers=ph, json=body)
        assert r.status_code == 403 and r.json()["error"]["code"] == "CAPTAIN_ONLY", (path, r.text)
    # player features still work
    assert (await client.get(f"{API}/players/me", headers=ph)).status_code == 200
    assert (await client.get(f"{API}/teams?scope=all", headers=ph)).status_code == 200

    captain = (await client.post(f"{API}/auth/register/email", json=form(play_as="captain"))).json()["data"]
    assert "captain" in captain["user"]["roles"] and captain["user"]["has_captain_profile"] is True
    ch = {"Authorization": f"Bearer {captain['access_token']}"}
    assert (await client.post(f"{API}/agreements/acceptance", headers=ch, json=accept)).status_code == 200
    r = await client.post(f"{API}/teams", headers=ch, json=team)
    assert r.status_code == 201, r.text
    assert (await client.get(f"{API}/players/me", headers=ch)).status_code == 200  # a captain is a player too
