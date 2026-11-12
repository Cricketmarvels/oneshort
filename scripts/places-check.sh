#!/usr/bin/env bash
# Ask the configured place provider for a ground and print what it found.
# Reads PLACES_* from backend/.env. Prints results only — never the key.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
Q="${1:-howzzat}"
cd "$ROOT/backend"
uv run python - "$Q" <<'PY'
import asyncio, sys
from app.core.config import Settings
from app.infrastructure.integrations.places import build_places_provider

async def main(q: str) -> None:
    s = Settings()
    p = build_places_provider(s)
    print(f"provider: {p.name}  country: {s.places_country or 'world'}  billed: {p.billed}")
    if p.name == "google" and not s.places_api_key:
        print("PLACES_API_KEY is not set — falling back to OpenStreetMap. See docs/GROUND_SEARCH_SETUP.md")
    try:
        found = await p.search(q, 28.5794, 77.3374, s.places_country)
    except Exception as exc:
        print(f"search failed: {type(exc).__name__}: {str(exc)[:200]}")
        raise SystemExit(1)
    print(f"{len(found)} result(s) for {q!r}:")
    for x in found:
        print(f"  {x.name} | {x.area}, {x.city} | {x.lat:.4f},{x.lng:.4f}")

asyncio.run(main(sys.argv[1]))
PY
