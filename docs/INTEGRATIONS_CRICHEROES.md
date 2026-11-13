# CricHeroes integration

## What it does
A team's captain or admins can:
- **Link** the team to its CricHeroes team page. The link can be on `cricheroes.com` or `cricheroes.in`, from any tab, or given as a bare `<id>/<slug>`. It is stored as a canonical `https://cricheroes.com/team-profile/<id>/<slug>` URL.
- **Import** the team's CricHeroes data:
  - **Manual entry:** players as `Name - Role` lines, stats as `Label: value` lines.
  - **JSON file:** max 2 MB, uploadable on the web or picked on iOS and Android.
- **View**: anyone signed in sees the team's stats, its CricHeroes squad (members matched by name get an "On OneShort" badge), recent matches and the batting, bowling and fielding leaderboards.
- **Remove**: deletes the link and the data.

Data is stored per team in the `cricheroes_teams` collection, which has a unique index on `team_id`. Every link, import and removal is audited; the audit records counts only.

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/teams/{id}/cricheroes` | any signed-in user |
| PUT | `/api/v1/teams/{id}/cricheroes/link` | captain or team admin |
| POST | `/api/v1/teams/{id}/cricheroes/import` | captain or team admin |
| POST | `/api/v1/teams/{id}/cricheroes/sync` | captain or team admin (returns 503 until a source is configured) |
| DELETE | `/api/v1/teams/{id}/cricheroes` | captain or team admin |

### File format
The field names match the JSON output of the community `cricheroes` package, so those files import unchanged. Unknown fields are ignored.
```json
{ "team_name": "…", "team_logo": "https://media.cricheroes.in/…",
  "players": [{ "name": "…", "sub_title": "Batsman", "profile_url": "/player-profile/…" }],
  "matches": [{ "tournament": "…", "info": "…", "score": ["…", "…"], "result": "…", "url": "/scorecard/…", "date": "07-Apr-23", "venue": "…" }],
  "stats": [{ "label": "Matches", "value": "42" }],
  "leaderboard": { "batting": [{ "player_name": "…", "stat": "812 runs" }], "bowling": [], "fielding": [] } }
```
**Limits:** 200 players, 300 matches, 50 stats, 100 entries per leaderboard. Strings are capped at 200 characters.

**Links:** only `https` URLs on CricHeroes hosts are kept; anything else (e.g. `javascript:`) is dropped. Relative paths resolve to `cricheroes.com`.

## Why there is no automatic fetch (yet)
The request was to integrate the [`cricheroes`](https://pypi.org/project/cricheroes/) PyPI package. I reviewed version 1.0.10 (2023-05-02, SHA-256 `0d87f9d1…cdba`) and did not use it:
1. **Terms of Service:** CricHeroes' terms (https://cricheroes.com/terms-of-services) say *"scraping the Services is prohibited"* and allow access only through *"published interfaces (e.g., APIs)"*. The package is a headless-Chrome scraper, and CricHeroes has no public API.
2. **It no longer works:** cricheroes.in now redirects to cricheroes.com, a Next.js site. None of the package's CSS selectors (`membersDiv`, `player-banner`, `matchesTab`, …) exist on the current pages.
3. **Code quality and security:** it launches Chrome with `--no-sandbox` and `--remote-debugging-port=9222`, which exposes browser control to local processes. It blocks for about 60 seconds or more on fixed sleeps, and it parses the fielding leaderboard from the batting page.

## Enabling automatic sync later
Once CricHeroes grants authorised access (a partner API or written permission):
1. Implement `CricHeroesSource.fetch_team()` in `backend/app/infrastructure/integrations/cricheroes.py`, returning the file format above.
2. Add its name to `Settings.cricheroes_source`, return it from `build_cricheroes_source`, and set `CRICHEROES_SOURCE`.

The Sync button, endpoint, storage and tests (`tests/api/test_cricheroes.py::test_sync_…`, which uses a fake source) need no other changes.
