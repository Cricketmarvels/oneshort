# Turning on Google ground search

GoFindr searches its own grounds first and asks a map provider for the rest
(`app/infrastructure/integrations/places.py`). The free OpenStreetMap provider is on by default and
needs nothing. This page is for switching to Google, which finds the small turf grounds OSM misses.

The code is already written and tested. Only the key and one env var are missing, and the key has to
be created by the account owner — it is tied to billing, so nobody else should make it.

## 1. Create the key (about five minutes, in the Google Cloud console)

1. Open <https://console.cloud.google.com/> and create a project, e.g. **GoFindr Maps**.
2. **Billing → Link a billing account.** Places API (New) refuses requests without one, even inside
   the free monthly allowance. A card is required; see the cost section below before continuing.
3. **APIs & Services → Library → Places API (New) → Enable.** Enable that one only — not the legacy
   "Places API", not Maps JavaScript, not Geocoding.
4. **APIs & Services → Credentials → Create credentials → API key.**
5. **Restrict the key straight away** (Edit API key):
   - *API restrictions* → Restrict key → **Places API (New)**.
   - *Application restrictions* → **IP addresses** → the server's public IP. The key only ever leaves
     GoFindr's backend, never the phone app, so this is safe and worth doing.
   - Set a quota: **APIs & Services → Places API (New) → Quotas** → a daily cap you're happy to pay.
     This is Google's own ceiling and is independent of GoFindr's `PLACES_DAILY_BUDGET`.

## 2. Give GoFindr the key

The key is a secret: it belongs in `backend/.env`, which git ignores. Paste it there yourself — not
into a chat, a commit, a screenshot or a log.

```
PLACES_PROVIDER=google
PLACES_API_KEY=…the key…
PLACES_COUNTRY=in
PLACES_DAILY_BUDGET=500
```

Restart the API. If `PLACES_API_KEY` is missing, the server logs `places.google_key_missing` and
keeps using OpenStreetMap rather than failing, so a bad deploy degrades instead of breaking search.

## 3. Check it works

```
./scripts/places-check.sh "howzzat"      # prints the grounds found, never the key
```

Then in the app: **Create a match → Venue**, search a ground that isn't seeded. It should appear
under "From the map"; picking it stores it as a GoFindr ground.

## What it costs

| | |
|---|---|
| Call made | One Text Search (`places:searchText`) per search, after a 300 ms pause in typing |
| Repeats | Answers are cached for `PLACES_CACHE_HOURS` (24h), so the same search costs nothing again |
| Tier | Text Search **Pro** — the `displayName` field sets it. About **5,000 free calls a month, then roughly $32 per 1,000** (Google's list price, Nov 2026 — check the current rate) |
| GoFindr's cap | `PLACES_DAILY_BUDGET` (default 500/day). Past it, search quietly falls back to grounds we already know; nothing breaks |
| Google's cap | The per-day quota you set in step 1.5 |

At the default cap the worst case is 500 calls a day. In a beta, caching and the seeded grounds mean
real usage is far below the free allowance.

**If volume ever grows:** Autocomplete (New) costs about $2.83 per 1,000 instead of $32, at the price
of a second call (Place Details, Essentials-only field mask) when a captain picks a ground. That is a
change to `GooglePlaces` alone — the endpoint, the storage and the app stay as they are.

## Going back

Set `PLACES_PROVIDER=osm` (free) or `none` (GoFindr's own grounds only) and restart. Grounds already
saved from Google results stay; they are ordinary GoFindr venues now.
