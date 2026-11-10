"""WhatsApp Cloud API (Meta) setup helper for GoFindr. Reads credentials from backend/.env; never prints them.

  uv run python -m scripts.whatsapp_meta_setup status            # token, phone number, templates + approval status
  uv run python -m scripts.whatsapp_meta_setup create-templates  # submit GoFindr's 3 templates for approval
  uv run python -m scripts.whatsapp_meta_setup test +9198XXXXXXXX  # send a test message (text in the 24-h window, else template)

Templates (names must match WHATSAPP_META_*_TEMPLATE in .env):
  playr_login_code    AUTHENTICATION  copy-code button; Meta supplies the fixed wording ("{code} is your verification code")
  playr_update        UTILITY         "GoFindr update: {{1}} ... {{2}} ... Open GoFindr: {{3}} to reply."
  playr_match_invite  UTILITY         captain, title, when, where, format/role, fee, link
"""

import asyncio
import sys
from typing import Any

import httpx

from app.core.config import get_settings
from app.infrastructure.integrations.whatsapp import build_whatsapp_sender, failure_reason

TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "playr_login_code",
        "category": "AUTHENTICATION",
        "components": [
            {"type": "BODY", "add_security_recommendation": True},
            {"type": "FOOTER", "code_expiration_minutes": 5},
            {"type": "BUTTONS", "buttons": [{"type": "OTP", "otp_type": "COPY_CODE", "text": "Copy code"}]},
        ],
    },
    {
        "name": "playr_update",
        "category": "UTILITY",
        "components": [
            {
                "type": "BODY",
                "text": "GoFindr update: {{1}}\n\n{{2}}\n\nOpen GoFindr: {{3}} to see details and reply.",
                "example": {
                    "body_text": [["Match cancelled", "Sunday T20 at Noida Stadium is off.", "https://gofindr.in"]]
                },
            }
        ],
    },
    {
        "name": "playr_match_invite",
        "category": "UTILITY",
        "components": [
            {
                "type": "BODY",
                "text": (
                    "You're invited to a GoFindr match.\n{{1}}\nMatch: {{2}}\nWhen: {{3}}\nWhere: {{4}}\n"
                    "Format: {{5}}\nFee: {{6}}\nAccept or decline in the GoFindr app: {{7}} before the match starts."
                ),
                "example": {
                    "body_text": [
                        [
                            "Rahul invited you to play for Sector 18 Kings",
                            "Sunday Morning T20",
                            "Sun 8 Nov, 7:00 AM",
                            "Noida Stadium, Sector 21A",
                            "T20 · Batter",
                            "About Rs 150 per head",
                            "https://gofindr.in/match/123",
                        ]
                    ]
                },
            }
        ],
    },
]


def _need(*names: str) -> dict[str, str]:
    s = get_settings()
    vals = {n: getattr(s, n) for n in names}
    missing = [n.upper() for n, v in vals.items() if not v]
    if missing:
        sys.exit(f"Missing in backend/.env: {', '.join(missing)}")
    return vals


def _api(path: str) -> str:
    return f"https://graph.facebook.com/{get_settings().whatsapp_meta_api_version}/{path}"


async def status() -> None:
    v = _need("whatsapp_meta_token", "whatsapp_meta_phone_number_id")
    h = {"Authorization": f"Bearer {v['whatsapp_meta_token']}"}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(
            _api(v["whatsapp_meta_phone_number_id"]),
            headers=h,
            params={"fields": "display_phone_number,verified_name,quality_rating"},
        )
        j = r.json()
        if r.status_code >= 400:
            sys.exit(
                f"Phone number check failed: Meta error {j.get('error', {}).get('code')} — {j.get('error', {}).get('message', '')[:160]}"
            )
        print(f"Sender: {j.get('display_phone_number')} ({j.get('verified_name')}), quality {j.get('quality_rating')}")
        waba = get_settings().whatsapp_meta_waba_id
        if not waba:
            print("Templates: set WHATSAPP_META_WABA_ID to list them.")
            return
        r = await c.get(
            _api(f"{waba}/message_templates"),
            headers=h,
            params={"fields": "name,status,category,language", "limit": 100},
        )
        rows = r.json().get("data", [])
        for t in sorted(rows, key=lambda t: t["name"]):
            mark = "*" if t["name"].startswith("playr_") else " "
            print(f" {mark} {t['name']:<24} {t['category']:<15} {t['language']:<6} {t['status']}")
        print(f"{len(rows)} template(s). GoFindr's are marked *.")


async def create_templates() -> None:
    v = _need("whatsapp_meta_token", "whatsapp_meta_waba_id")
    h = {"Authorization": f"Bearer {v['whatsapp_meta_token']}"}
    lang = get_settings().whatsapp_meta_language
    async with httpx.AsyncClient(timeout=20) as c:
        for t in TEMPLATES:
            r = await c.post(
                _api(f"{v['whatsapp_meta_waba_id']}/message_templates"), headers=h, json={**t, "language": lang}
            )
            j = r.json()
            if r.status_code >= 400:
                e = j.get("error", {})
                print(
                    f"{t['name']}: not created — Meta error {e.get('code')}: {(e.get('error_user_msg') or e.get('message') or '')[:200]}"
                )
            else:
                print(f"{t['name']}: submitted, status {j.get('status')}")
    print(
        "Then add to backend/.env: WHATSAPP_META_OTP_TEMPLATE=playr_login_code, WHATSAPP_META_NOTIFY_TEMPLATE=playr_update, "
        "WHATSAPP_META_TEMPLATE=playr_match_invite (only once each shows APPROVED in `status`)."
    )


async def test(number: str) -> None:
    s = get_settings()
    if s.whatsapp_provider != "meta":
        sys.exit("Set WHATSAPP_PROVIDER=meta in backend/.env first.")
    wa = build_whatsapp_sender(s)
    st = await wa.send(
        number,
        "GoFindr test: WhatsApp is connected.",
        ["WhatsApp is connected", "This is a GoFindr test message.", s.app_base_url or s.web_base_url],
        "notify",
    )
    print(
        f"Result: {st}"
        + ("" if st == "sent" else f" — {failure_reason(wa)} (Meta code {getattr(wa, 'last_error', None)})")
    )


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        asyncio.run(status())
    elif cmd == "create-templates":
        asyncio.run(create_templates())
    elif cmd == "test" and len(sys.argv) > 2:
        asyncio.run(test(sys.argv[2]))
    else:
        sys.exit(__doc__)
