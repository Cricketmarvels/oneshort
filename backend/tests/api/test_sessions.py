"""Device sessions: list, revoke one, sign-out-everywhere with immediate access-token death."""

import asyncio

import httpx

from app.core.container import Container
from tests.conftest import register

API = "/api/v1"


async def _password_login(client: httpx.AsyncClient, email: str, password: str, ua: str) -> dict:
    r = await client.post(f"{API}/auth/login", json={"email": email, "password": password}, headers={"user-agent": ua})
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_sessions_list_revoke_and_logout_all(client: httpx.AsyncClient, container: Container) -> None:
    u = await register(client, "Session Haver", password="SessionPass2026")
    email = f"{u.mobile}@example.invalid"  # placeholder; real email from register helper below
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    email = me["email"]

    phone = await _password_login(client, email, "SessionPass2026", "GoFindr/1.0 (iPhone 15)")
    laptop = await _password_login(client, email, "SessionPass2026", "Mozilla/5.0 (Macintosh)")
    h_phone = {"Authorization": f"Bearer {phone['access_token']}"}
    h_laptop = {"Authorization": f"Bearer {laptop['access_token']}"}

    rows = (await client.get(f"{API}/auth/sessions", headers=h_phone)).json()["data"]
    assert len(rows) >= 3  # register-OTP session + 2 password logins
    current = [r for r in rows if r["current"]]
    assert len(current) == 1 and "iPhone" in current[0]["user_agent"]

    # revoke the laptop session from the phone: its refresh dies, other sessions keep working
    laptop_id = next(r["id"] for r in rows if "Macintosh" in r["user_agent"])
    assert (await client.delete(f"{API}/auth/sessions/{laptop_id}", headers=h_phone)).status_code == 204
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": laptop["refresh_token"]})
    assert r.status_code == 401
    assert (await client.get(f"{API}/users/me", headers=h_phone)).status_code == 200

    # another user cannot revoke my session
    other = await register(client, "Session Outsider")
    assert (await client.delete(f"{API}/auth/sessions/{laptop_id}", headers=other.h)).status_code == 404

    # sign out everywhere: refreshes die AND already-issued access tokens die immediately (iat check)
    await asyncio.sleep(1.1)  # iat has second resolution; make the cut-off strictly later
    assert (await client.post(f"{API}/auth/logout-all", headers=h_phone)).status_code == 204
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": phone["refresh_token"]})).status_code == 401
    dead = await client.get(f"{API}/users/me", headers=h_laptop)
    assert dead.status_code == 401 and dead.json()["error"]["code"] == "TOKEN_REVOKED"
    dead2 = await client.get(f"{API}/users/me", headers=h_phone)
    assert dead2.status_code == 401 and dead2.json()["error"]["code"] == "TOKEN_REVOKED"

    # logging in again works and the new access token is accepted (iat after the cut-off)
    fresh = await _password_login(client, email, "SessionPass2026", "GoFindr/1.0 (iPhone 15)")
    assert (
        await client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {fresh['access_token']}"})
    ).status_code == 200
