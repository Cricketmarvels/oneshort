# GoFindr asset inventory

Last audited: 2026-11-08. Keep this file in step with `assets/images/CREDITS.md` whenever an asset is added or removed.

## 1. Functional icons

| Asset | Source | Licence | Where |
|---|---|---|---|
| `PlayRIcon` (40 names: nav, utility, roles) | `@tabler/icons-react-native` ^3.50 | MIT | `src/components/icons.tsx`, used app-wide. Sizes: 24 px for navigation, 20 px for utility. |
| Legacy inner-screen icons | `lucide-react-native` | ISC | 34 files still import Lucide (inner screens such as fee, chat, fixture, profile and team management). Migrate to `PlayRIcon` over time. |

The `MAP` in `icons.tsx` is typed `Record<PlayRIconName, …>`, so adding a name without an icon fails `tsc`.

## 2. Illustrations and pictograms

| Asset | Source | Licence | Where |
|---|---|---|---|
| `SportsActionIcon`: findPlayers, findTeams, bookGround, splitFees, createMatch, manageTeam, challenge | Drawn in-house as SVG for GoFindr | Owned by GoFindr | Home quick-action tiles (through `SportsActionArtwork`), ground and match fallbacks |
| `ARTWORK` registry in `src/components/media.tsx` | **Empty.** Awaiting licensed artwork (see section 5). | — | `SportsActionArtwork` uses an entry here when one exists, otherwise the in-house pictogram |
| `CricketBanner` (team cover fallback), match fallback tile, `TeamLogo` monogram | Generated in code (gradients and shapes) | Owned by GoFindr | Team cards, team page, match cards and match page |

## 2a. Link-preview card

| Asset | Source | Licence | Where |
|---|---|---|---|
| `mobile/public/og/gofindr-card.png` (1200×630) | Made for GoFindr with Pillow: brand teal gradient and wordmark, no sports artwork | Owned by GoFindr. Text is set in Inter (SIL OFL 1.1). | `og:image` for every web page, including WhatsApp previews of join links (added by `scripts/serve-web.mjs`) |

## 3. Bundled photography (`assets/images/`)

Full attribution is in `assets/images/CREDITS.md`.

| File | Licence | Used in |
|---|---|---|
| `batting-action.jpg` | CC BY-SA 3.0 | Player Home hero (`SportsHeroBanner` default) |
| `club-ground.jpg` | CC BY-SA 4.0 | Captain Home hero, Quick Match banner, community header |
| `stadium-crowd.jpg` | CC BY-SA 4.0 | Welcome screen, fixture hero, team challenge card |
| `bowler.jpg` | CC BY-SA 4.0 | Not currently used |
| `street-india.jpg` | CC BY 2.0 | Not currently used |

These are decorative stock photos only. They are never shown as a specific team's, match's or venue's own image.

## 4. User-uploaded media

| Media | Upload purpose | Who can set it | Processing |
|---|---|---|---|
| Player photo | `profile` | The user themself | Pillow re-encode, EXIF/GPS stripped, longest edge 800 px |
| Team logo | `team_logo` | Team captain or admin | Same, 600 px |
| Team cover | `team_cover` | Team captain or admin | Same, 1800 px, 16:9 crop |
| Match photo | `match` | Match manager | Same, 1800 px, 16:9 crop |
| Ground photos | — | **Not built.** Needs a venue-ownership model. | — |

- Media fields accept only GoFindr upload paths (`OwnMediaUrl`). External URLs are rejected with 422.
- Every image component falls back when the URL is missing or when the image fails to load. On a failure it shows the monogram, `CricketBanner` or the "No photos from this venue yet" tile.

## 5. Open items

1. **Licensed sports artwork (Phase 3): not supplied.** Needed:
   - 7 action illustrations matching the `SportsAction` keys.
   - A hero illustration each for cricket, badminton and pickleball.
   - Sources considered: IconScout or Streamline, commercial licence. Purchase and approval are with the product owner.
   - Once approved, drop the files in `assets/images/art/`, register them in `ARTWORK`, and add rows to this file.
2. **DiceBear seed media: resolved (V5.1).**
   - Removed from `seed_data.py`.
   - 61 profile photos and 6 team logos were cleared by `scripts/migrate_media_policy.py`, which uses the same `is_own_media` rule as the API, audits each removal and keeps valid uploads.
3. **`stadium-night.jpg`: deleted (V5.1).** It had no licence on record and nothing referenced it.
