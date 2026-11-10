# GoFindr beta — WhatsApp OTP and match notifications: setup

Status: **BLOCKED on a WhatsApp Business sender, approved templates and billing.** The code paths exist and are tested with a fake provider; nothing has been sent to a real number from this repo. Date: 2026-11-10.

## 1. What exists in the code

| Piece | Where | State |
|---|---|---|
| Provider abstraction | `backend/app/infrastructure/integrations/whatsapp.py` — `MetaWhatsApp`, `TwilioWhatsApp`, `SimulatorWhatsApp`, `DisabledWhatsApp` | Coded; simulator used end to end in tests and the demo |
| OTP over WhatsApp | `POST /auth/register` / `/auth/send-otp` with `channel: "whatsapp"`; code never echoed when a real channel delivers | Tested (`test_whatsapp_channel.py`) |
| Match-invitation / reminder messages | `NotificationService._whatsapp` for opted-in users (`notification_prefs.whatsapp`), types in `WHATSAPP_TYPES` | Tested with fake provider |
| Webhook | `POST /whatsapp/webhook` — rejects unsigned posts; signature = `X-Hub-Signature-256` with the Meta app secret; events stored 400 days | Tested (`test_security_auth.py`) |
| Delivery states | `whatsapp_events` (sent/delivered/read/failed from the webhook); `invitations.whatsapp_status` | Recorded, surfaced to captains ("WhatsApp message sent / couldn't be delivered…") |
| Abuse controls | OTP budgets apply to paid WhatsApp sends (`abuse.py`): +91 allowlist, per-number/day, per-IP/hour, global daily budget | Tested |
| Opt-in / opt-out | Profile → "WhatsApp updates" switch; stored per user; invitations never sent without it | Tested |

## 2. Provider decision: Meta WhatsApp Cloud API (direct)

| | Meta Cloud API (recommended) | Twilio WhatsApp |
|---|---|---|
| Cost per authentication message (India) | Meta conversation fee only | Meta fee **plus** Twilio per-message fee |
| Authentication templates with copy-code button | Native | Supported via Content API |
| Sandbox limits | Test numbers (up to 5) can receive without approval | Sandbox needs each recipient to send a join code first — **not usable for real testers** |
| Already in repo | `MetaWhatsApp` adapter, `scripts/whatsapp_meta_setup.py` (creates templates), webhook verification | `TwilioWhatsApp` adapter |

Twilio remains as a fallback adapter; the beta should go direct to Meta.

## 3. Setup steps (owner; needs a Meta Business account and a card)

1. **Meta Business + App:** business.facebook.com → verify the business (government ID + business document; 1–5 days). developers.facebook.com → create an app → add the *WhatsApp* product.
2. **Phone number:** add a number not already registered on WhatsApp (a new SIM or a virtual number). Display name "GoFindr". Until business verification completes, the sender can message only 5 test numbers.
3. **Templates** (Meta approves in minutes to 24 h). The repo's `uv run python -m scripts.whatsapp_meta_setup` submits these; adjust the names in `.env`:
   - `WHATSAPP_META_OTP_TEMPLATE` — category **Authentication**, body "{{1}} is your GoFindr verification code.", copy-code button, 5-minute expiry text.
   - `WHATSAPP_META_TEMPLATE` — category **Utility**: "You're invited to a cricket match with {{1}} on {{2}}. Open GoFindr to view the invitation." (no personal data).
   - `WHATSAPP_META_NOTIFY_TEMPLATE` — Utility: "{{1}}: {{2}}. Open GoFindr: {{3}}".
4. **Webhook:** in the app's WhatsApp settings set the callback URL to `https://<beta-api>/api/v1/whatsapp/webhook`, the verify token to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, subscribe to `messages`.
5. **Backend `.env` (beta host, never the app):**
   ```
   WHATSAPP_PROVIDER=meta
   WHATSAPP_META_TOKEN=<system-user token, never expires>
   WHATSAPP_META_PHONE_NUMBER_ID=<id>
   WHATSAPP_META_WABA_ID=<id>
   WHATSAPP_META_APP_SECRET=<app secret>
   WHATSAPP_WEBHOOK_VERIFY_TOKEN=<random 32+ chars>
   WHATSAPP_META_OTP_TEMPLATE=playr_otp
   WHATSAPP_META_TEMPLATE=playr_match_invite
   WHATSAPP_META_NOTIFY_TEMPLATE=playr_update
   OTP_ALLOWED_PREFIXES=["+91"]
   OTP_DAILY_BUDGET=1000
   ```
6. **SMS fallback (optional but recommended):** MSG91 with a DLT-registered sender for players without WhatsApp — `OTP_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`. DLT registration takes days to weeks; start it now.

Policy notes: only approved templates are sent; marketing content is never sent through utility templates; users opt in explicitly; opt-out is the Profile switch. No unofficial WhatsApp automation is used anywhere.

## 4. Verification on real numbers (after step 5)

| Scenario | How | Pass when |
|---|---|---|
| New user registers | Sign up with a real +91 number, channel WhatsApp | Code arrives in WhatsApp within ~10 s; no code on screen |
| Existing user logs in | Log in with the same number | Same |
| Wrong / expired code | Enter a wrong code 5×; wait 5 min | `OTP_INVALID` ×5 then `OTP_LOCKED`; `OTP_EXPIRED` after TTL |
| Resend | Tap resend inside 30 s, then after | Cooldown error, then a new code |
| Rate limit | 6th send in an hour | `OTP_RATE_LIMITED` |
| Delivery failure | Number without WhatsApp | `OTP_DELIVERY_FAILED` with a helpful message; no secret in logs |
| Match invitation | Opted-in player invited | Template arrives; `whatsapp_status=sent`, webhook turns it `delivered` |
| Logs | `grep -c "otp\|code" api.log` after the run | Codes and numbers absent (redaction already covers these keys) |

Record the results in `PLAYR_REAL_DEVICE_TEST_MATRIX.md` (TC-02, TC-03, TC-12).
