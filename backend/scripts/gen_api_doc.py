"""Generate docs/API_SPECIFICATION.md from the live FastAPI app (routes + OpenAPI).

Auth/authorization columns are derived by walking each route's dependency tree, so the
document cannot drift from the code. Run: uv run python -m scripts.gen_api_doc
"""

from pathlib import Path
from typing import Any

from fastapi.routing import APIRoute

from app.api.dependencies import get_current_user, require_admin, require_matchmaking
from app.core.config import Settings
from app.main import create_app

HEADER = """# API Specification (v1)

> **Generated** from the running FastAPI application by `backend/scripts/gen_api_doc.py`. Do not edit by hand.
> Interactive docs: `GET /docs` (Swagger UI) · `GET /redoc` · machine-readable: `GET /api/v1/openapi.json`
> (also committed as `shared/openapi.json`, from which `shared/src/api-types.ts` is generated).

## Conventions
- Base URL `/api/v1`, JSON, `snake_case`. Datetimes are ISO-8601 with an offset (stored in UTC). Money is integer **paise**.
- Success: `{"data": …}`; paginated: `{"data": […], "meta": {page, page_size, total, has_next}}` (`?page=&page_size=`, max 100).
- Error: `{"error": {"code", "message", "details": [{field, message, type}]}, "request_id"}`, with HTTP 400/401/403/404/409/422/429.
- Auth: `Authorization: Bearer <access JWT>` (15 min). Rotate with `POST /auth/refresh`.
- **Auth** column: `public` | `user` (any authenticated, non-suspended user) | `matchmaker` (user + accepted current
  agreement + not restricted) | `admin`. **Resource rules** lists the extra checks the service layer enforces.
- Request bodies reject unknown fields and any key starting with `$` or containing `.`.

## Common error codes
| Code | When |
|---|---|
| `VALIDATION_ERROR` | Body or query failed validation (see `details`) |
| `TOKEN_EXPIRED` / `TOKEN_INVALID` | Refresh the access token / log in again |
| `AGREEMENT_REQUIRED` | Accept the current Platform User Agreement |
| `ACCOUNT_SUSPENDED` / `MATCHMAKING_RESTRICTED` | Moderation state |
| `NOT_TEAM_MANAGER` / `NOT_MATCH_MANAGER` | Resource-level authorization failed |
| `SQUAD_FULL` | Capacity guard (also under concurrency) |
| `DUPLICATE_INVITATION` / `ALREADY_IN_SQUAD` / `PLAYER_DOUBLE_BOOKED` | Invitation integrity |
| `PLAYER_UNAVAILABLE` | Invitee is unavailable or has no availability for the match window |
| `INVALID_MATCH_TRANSITION` / `INVALID_INVITATION_TRANSITION` / `INVALID_PAYMENT_TRANSITION` | State machine violation |
| `AVAILABILITY_CONFLICT` | Overlapping availability slot (`details[0].conflicting_slot_id`) |
| `SETTLEMENT_IMMUTABLE` / `SETTLEMENT_NOT_CURRENT` | Published settlements are read-only, revise instead |
| `DUPLICATE_RATING` / `NOT_VERIFIED_PARTICIPANT` / `RATING_WINDOW_CLOSED` | Reputation rules |
| `OTP_INVALID` / `OTP_EXPIRED` / `OTP_LOCKED` / `OTP_RATE_LIMITED` / `OTP_COOLDOWN` | OTP flow |
| `RATE_LIMITED` | Too many requests (`Retry-After`) |
"""

RULES: dict[str, str] = {
    "POST /matches": "team captain/admin",
    "PUT /matches/{match_id}": "match manager; editable states only; reschedule notifies squad",
    "POST /matches/{match_id}/transition": "match manager; lifecycle state machine",
    "POST /matches/{match_id}/cancel": "match manager",
    "POST /matches/{match_id}/complete": "match manager; attendance updates reliability",
    "POST /matches/{match_id}/invitations": "match manager; availability + duplicate checks per invitee",
    "GET /matches/{match_id}/invitations": "match manager",
    "POST /matches/{match_id}/join-requests": "not a manager; vacancies > 0; not unavailable/double-booked",
    "GET /matches/{match_id}/roster": "match manager or squad member",
    "POST /matches/{match_id}/roster": "match manager; transactional capacity guard",
    "PUT /matches/{match_id}/roster/{player_id}": "match manager",
    "POST /matches/{match_id}/roster/{player_id}/replace": "match manager",
    "POST /matches/{match_id}/withdraw": "squad member (not captain)",
    "POST /invitations/{invitation_id}/accept": "invitee only (direction=invite)",
    "POST /invitations/{invitation_id}/reject": "invitee (invite) or match manager (join request)",
    "POST /invitations/{invitation_id}/cancel": "match manager, or requester of a join request",
    "POST /invitations/{invitation_id}/confirm": "match manager; capacity guard; double-booking check",
    "POST /discovery/players": "match manager when match_id given",
    "PUT /teams/{team_id}": "team captain/admin",
    "POST /teams/{team_id}/members": "team captain/admin (admin role: captain only)",
    "PUT /teams/{team_id}/members/{player_id}": "team captain",
    "DELETE /teams/{team_id}/members/{player_id}": "self (leave) or team captain/admin",
    "PUT /availability/{availability_id}": "owner",
    "DELETE /availability/{availability_id}": "owner",
    "POST /matches/{match_id}/expenses": "match manager",
    "DELETE /matches/{match_id}/expenses/{expense_id}": "match manager",
    "GET /matches/{match_id}/expenses": "match manager or participant",
    "POST /matches/{match_id}/settlements": "match manager; draft only",
    "GET /matches/{match_id}/settlements": "manager (incl. drafts) or participant (published)",
    "POST /settlements/{settlement_id}/publish": "match manager; draft → published (transaction)",
    "GET /settlements/{settlement_id}/payments": "match manager or settlement participant",
    "POST /settlements/{settlement_id}/payments/{player_id}/mark-paid": "match manager only; audited; notifies player",
    "POST /settlements/{settlement_id}/payments/{player_id}/mark-exempted": "match manager only; audited",
    "POST /settlements/{settlement_id}/payments/{player_id}/correct": "match manager; reason required; audited",
    "POST /settlements/{settlement_id}/payments/{player_id}/dispute": "the player themselves only",
    "POST /settlements/{settlement_id}/payments/{player_id}/remind": "match manager",
    "GET /payments/{record_id}/discussion": "record's player or match manager",
    "POST /payments/{record_id}/discussion": "record's player or match manager",
    "POST /matches/{match_id}/ratings": "verified participants of a completed match, within window, once",
    "GET /matches/{match_id}/ratings/pending": "verified participant",
    "POST /reports": "not self; no duplicate open report",
    "GET /players/{player_id}": "public profile, no location/contact",
    "GET /matches/{match_id}": "venue address/coords only for manager/invitee/squad",
}


def auth_level(route: APIRoute) -> str:
    calls: set[Any] = set()

    def walk(dep: Any) -> None:
        for d in dep.dependencies:
            calls.add(d.call)
            walk(d)

    walk(route.dependant)
    if require_admin in calls:
        return "admin"
    if require_matchmaking in calls:
        return "matchmaker"
    if get_current_user in calls:
        return "user"
    return "public"


def schema_name(ref_holder: dict[str, Any] | None) -> str:
    if not ref_holder:
        return "—"
    s = ref_holder.get("schema", {})
    ref = s.get("$ref") or (s.get("items") or {}).get("$ref")
    if ref:
        name = ref.rsplit("/", 1)[-1]
        return f"`{name}`" + ("[]" if "items" in s else "")
    return "`multipart/form-data`" if "multipart" in str(ref_holder) else "—"


def iter_routes(routes: list[Any], prefix: str = "") -> list[tuple[str, APIRoute]]:
    """Flatten (possibly lazily) included routers into (full_path, route) pairs."""
    out: list[tuple[str, APIRoute]] = []
    for r in routes:
        if isinstance(r, APIRoute):
            out.append((prefix + r.path, r))
        elif hasattr(r, "original_router"):
            out += iter_routes(r.original_router.routes, prefix + r.include_context.prefix)
    return out


def main() -> None:
    app = create_app(Settings(scheduler_enabled=False))
    spec = app.openapi()
    by_tag: dict[str, list[str]] = {}
    for path, route in iter_routes(app.routes):
        if not path.startswith("/api/v1"):
            continue
        for method in sorted(route.methods - {"HEAD"}):
            op = spec["paths"][path][method.lower()]
            short = path.removeprefix("/api/v1")
            body = op.get("requestBody", {}).get("content", {})
            req = (
                schema_name(body.get("application/json"))
                if "application/json" in body
                else ("`multipart/form-data`" if body else "—")
            )
            ok_code = next((c for c in op["responses"] if c.startswith("2")), "200")
            res = (
                schema_name(op["responses"][ok_code].get("content", {}).get("application/json"))
                if ok_code != "204"
                else "204 No Content"
            )
            params = ", ".join(f"`{p['name']}`" for p in op.get("parameters", []) if p["in"] == "query")
            tag = (op.get("tags") or ["Other"])[0]
            by_tag.setdefault(tag, []).append(
                f"| `{method}` | `{short}` | {op.get('summary', '')} | {auth_level(route)} | "
                f"{RULES.get(f'{method} {short}', '')} | {req} | {res} | {params or '—'} |"
            )
    lines = [HEADER]
    for tag, rows in by_tag.items():
        lines += [
            f"\n## {tag}\n",
            "| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |",
            "|---|---|---|---|---|---|---|---|",
            *rows,
        ]
    lines.append(
        "\n## WebSocket\n`GET /api/v1/ws?token=<access JWT>`: server → client JSON frames `{event, payload}`. Events: "
        "`notification.created`, `invitation.updated`, `roster.updated`, `match.updated`, `payment.updated`, "
        "`team.membership.updated`. Close code 4401 means an invalid token. Clients should refetch over REST on each event.\n"
    )
    lines.append(
        "\n## Health\n`GET /health/live` (process up) · `GET /health/ready` (MongoDB reachable, otherwise 503).\n"
    )
    lines.append(
        "\n## Schemas\nAll request/response schemas (fields, types, constraints, enums) are in `shared/openapi.json` and "
        "browsable at `/docs`. TypeScript types: `shared/src/api-types.ts`.\n"
    )
    out = Path(__file__).resolve().parents[2] / "docs" / "API_SPECIFICATION.md"
    out.write_text("\n".join(lines))
    print(f"wrote {out} ({sum(len(r) for r in by_tag.values())} operations)")


if __name__ == "__main__":
    main()
