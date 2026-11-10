# GoFindr beta — GPS nearby-player discovery: implementation and test plan

Date: 2026-11-10. Decision for the beta: **list-first, foreground location only**.

## What is implemented (verified by backend tests)

| Requirement | Implementation | Evidence |
|---|---|---|
| Foreground permission, real coordinates | `expo-location` (`NSLocationWhenInUseUsageDescription` set); "use my current location" or a manual area (`PLACES`) | `lib/location.ts`, `lib/device.ts` |
| Radius 5 / 10 / 20 km | Pills on Find Players / Find Teams; server validates `radius_km` and lat/lng ranges | `test_find.py` |
| Geospatial search | `player_profiles.home_location` GeoJSON + `2dsphere`; `$geoNear` with `maxDistance`, capped at 500 candidates, 60 results | explain-plan audit (no collection scans) |
| Distances | Server computes and **rounds to 0.5 km** (`approx_km`); the API never returns another user's coordinates | `competition/schemas.py` |
| Filters | role, min rating, available-this-week, name search, sort by distance/rating | `test_find.py` |
| Exclusions | self; `availability_visibility: private`; **users blocked in either direction (new, 2026-11-10)**; deleted/suspended accounts | `test_nearby_blocks.py` |
| Anti-scraping | per-IP rate limit (240/min, Mongo-shared when enabled); result cap; approximate distances; no coordinate fields | middleware tests |
| Map view | Privacy-safe SVG preview with approximate dots (no tiles, no exact pins) | screenshots |
| Denied permission / no GPS | Falls back to the chosen area; discovery still works | UI code |

## Not implemented (by decision)

- **Real map tiles / markers.** `react-native-maps` needs a development build and an Apple Maps/Google key review. The beta ships list-first with the approximate preview; revisit after device testing (TC-09 will read PARTIAL).
- **Background location.** Not needed for discovery; only "When In Use" is requested. See the release plan §Phase 9.

## Real-device test plan (needs ≥2 iPhones with development builds)

| ID | Steps | Expected |
|---|---|---|
| G-1 | Phone A in Sector 18, Phone B in Sector 50 (~5–6 km apart). On A: Find Players, 5 km | B absent |
| G-2 | On A: 10 km | B present with "~5.5 km" (rounded) |
| G-3 | On A: 20 km | B present; count ≥ G-2 |
| G-4 | Toggle Map / List at 10 km | Same count and names in both views |
| G-5 | Deny location on A | Area picker fallback; results for the chosen area |
| G-6 | A blocks B from B's profile | B disappears from A's list and A from B's |
| G-7 | B sets availability visibility private | B disappears from A's list |
| G-8 | Remote area, 5 km | Empty state with "Show 20 km" action |
| G-9 | Inspect network traffic (proxy) | No `home_location` or raw coordinates in any response |

Record results in `PLAYR_REAL_DEVICE_TEST_MATRIX.md` (TC-06…TC-09, TC-18).
