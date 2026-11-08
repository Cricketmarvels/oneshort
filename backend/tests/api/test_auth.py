import httpx

from app.core.container import Container
from tests.conftest import register, unique_mobile

API = "/api/v1"


async def test_register_and_verify_otp(client: httpx.AsyncClient) -> None:
    u = await register(client, "Virat Sharma", agree=False)
    r = await client.get(f"{API}/users/me", headers=u.h)
    assert r.status_code == 200
    me = r.json()["data"]
    assert me["full_name"] == "Virat Sharma"
    assert me["mobile_verified"] is True
    assert me["roles"] == ["player"]
    assert me["agreement"]["satisfied"] is False


async def test_duplicate_registration_rejected(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    r = await client.post(
        f"{API}/auth/register", json={"full_name": "Someone", "mobile_number": u.mobile, "email": "other@example.com"}
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "ACCOUNT_EXISTS"


async def test_wrong_otp_and_attempt_lockout(client: httpx.AsyncClient) -> None:
    mobile = unique_mobile()
    r = await client.post(
        f"{API}/auth/register", json={"full_name": "Lock Test", "mobile_number": mobile, "email": f"{mobile[1:]}@x.com"}
    )
    real = r.json()["data"]["otp"]["dev_otp"]
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(5):
        r = await client.post(
            f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": wrong, "purpose": "register"}
        )
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "OTP_INVALID"
    # 6th attempt (even with the right code) is locked
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": real, "purpose": "register"})
    assert r.json()["error"]["code"] == "OTP_LOCKED"


async def test_login_via_otp_and_unknown_number(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "login"})
    assert r.status_code == 200
    code = r.json()["data"]["dev_otp"]
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": u.mobile, "code": code})
    assert r.status_code == 200 and r.json()["data"]["access_token"]

    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": unique_mobile()})
    assert r.status_code == 404


async def test_otp_is_single_use(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    code = (await client.post(f"{API}/auth/send-otp", json={"mobile_number": u.mobile})).json()["data"]["dev_otp"]
    assert (
        await client.post(f"{API}/auth/verify-otp", json={"mobile_number": u.mobile, "code": code})
    ).status_code == 200
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": u.mobile, "code": code})
    assert r.status_code == 401


async def test_refresh_rotation_and_reuse_detection(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    r1 = await client.post(f"{API}/auth/refresh", json={"refresh_token": u.refresh})
    assert r1.status_code == 200
    new_refresh = r1.json()["data"]["refresh_token"]
    assert new_refresh != u.refresh
    # Reusing the old token is detected and revokes the family, including the new token.
    r2 = await client.post(f"{API}/auth/refresh", json={"refresh_token": u.refresh})
    assert r2.status_code == 401 and r2.json()["error"]["code"] == "REFRESH_REUSED"
    r3 = await client.post(f"{API}/auth/refresh", json={"refresh_token": new_refresh})
    assert r3.status_code == 401


async def test_logout_revokes(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    assert (await client.post(f"{API}/auth/logout", json={"refresh_token": u.refresh})).status_code == 204
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": u.refresh})
    assert r.status_code == 401


async def test_password_login_and_reset(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False, password="Cover2Drive")
    email = f"{u.mobile[1:]}@example.com"
    bad = await client.post(f"{API}/auth/login", json={"email": email, "password": "wrong1234"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_CREDENTIALS"
    good = await client.post(f"{API}/auth/login", json={"email": email, "password": "Cover2Drive"})
    assert good.status_code == 200

    code = (
        await client.post(f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "reset_password"})
    ).json()["data"]["dev_otp"]
    r = await client.post(
        f"{API}/auth/reset-password", json={"mobile_number": u.mobile, "code": code, "new_password": "Yorker99x"}
    )
    assert r.status_code == 204
    assert (await client.post(f"{API}/auth/login", json={"email": email, "password": "Yorker99x"})).status_code == 200


async def test_requires_auth_and_rejects_garbage_token(client: httpx.AsyncClient) -> None:
    assert (await client.get(f"{API}/users/me")).status_code == 401
    r = await client.get(f"{API}/users/me", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "TOKEN_INVALID"


async def test_validation_errors_and_nosql_guard(client: httpx.AsyncClient) -> None:
    r = await client.post(f"{API}/auth/register", json={"full_name": "X", "mobile_number": "123", "email": "bad"})
    assert r.status_code == 422
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"full_name", "mobile_number", "email"} <= fields
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": {"$ne": None}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_INPUT"


async def test_security_headers_and_request_id(client: httpx.AsyncClient) -> None:
    r = await client.get("/health/live")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["X-Request-ID"]


async def test_dev_otp_hidden_when_disabled(client: httpx.AsyncClient, container: Container) -> None:
    """Public-tunnel mode: the console adapter must not reveal codes in responses."""
    u = await register(client, "Hidden Otp")
    container.settings.dev_otp_in_response = False
    try:
        r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "login"})
        assert r.status_code == 200 and r.json()["data"]["dev_otp"] is None
    finally:
        container.settings.dev_otp_in_response = True
