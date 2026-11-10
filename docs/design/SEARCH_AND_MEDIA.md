# Search engine and private media — design

Date: 2026-11-10. Status: implemented (local storage, MongoDB 8 replica set). Scale path noted per section.

## 1. Private media (uploaded photos)

### Threat model
Profile photos, team logos/covers and match photos are personal data. Nobody should be able to fetch them by
guessing or sharing a path, scrape the upload folder, or keep a link working forever.

### Design
| Layer | Decision |
|---|---|
| Storage | Files stay outside any web-served folder. The public `/uploads` static mount is **removed**. |
| Database | Stores only a private **key**: `/uploads/<purpose>/<32-hex>.<ext>`. Keys are random (128-bit), not derived from the user. |
| Output | Every API response passes through the envelope serializer, which rewrites keys to **signed links**: `/api/v1/media/<purpose>/<name>?e=<expiry>&s=<HMAC>`. Default life: 48 h (`MEDIA_LINK_TTL_SECONDS`). |
| Serving | `GET /api/v1/media/...` verifies the HMAC-SHA256 over `purpose/name:expiry` (key derived from the app secret) with constant-time compare, checks expiry, resolves strictly inside the upload root, and returns the file with `Cache-Control: private`, `nosniff`. Any failure is the same 404. |
| Input | Clients send back whatever they received; `OwnMediaUrl` accepts the key or our own signed link and **normalises to the key** before saving. External URLs are still rejected (422). |
| Processing | Unchanged from V5: Pillow re-encode, EXIF/GPS stripped, resized per purpose, MIME sniffed, 5 MB cap. |
| Access policy | Signed links are not tied to a user: an `<img>` tag cannot send a bearer token, and anyone who can see the page already has the right to see the image. Expiry limits how long a leaked link lives. |

Why not an authenticated endpoint? Image loads in web browsers cannot carry `Authorization`; cookies would reopen
CSRF and cross-origin issues on the tunnel/domain setup. Signed URLs are the pattern S3/R2/GCS use, which is also
the production path.

### Production path
Swap `LocalStorage` for an object store with **private buckets** (Cloudflare R2 or S3): `save_image` writes with no
public ACL; `sign_key` becomes a presigned GET (same TTL). The envelope rewrite and `OwnMediaUrl` do not change.
Add a CDN only in front of the signed URLs (R2 custom domain honours the signature).

## 2. Search engine (players, teams, grounds)

### Requirements
* Instant results while typing (sub-50 ms server time), by name or the start of a name, across three entity types.
* Tolerant of common spelling variants in Indian names (Rao/Rau, Shubhang/Subhang, Qureshi/Kureshi).
* Shows a player's role, area, verified matches and CricHeroes profile; a team's area and size; a ground's address and distance.
* Must not slow down as users/teams/grounds grow; must never expose blocked or deleted users or exact home locations.

### Algorithm: edge n-gram inverted index + bounded in-process ranking
1. **One denormalised index collection** `search_index`, one small document per entity:
   `type, entity_id, name, name_norm, tokens[], phonetic[], area, city, loc, boost, image, meta{…}, updated_at`.
   Reads never touch `users`, `player_profiles`, `teams` or `venues`, so a search costs the same whether a
   team has 10 members or 10,000 users exist.
2. **tokens** = every prefix (1..16 chars) of every word in the name plus area/city words. `"Rahul Menon"` →
   `r, ra, rah, …, rahul, m, me, …, menon`. A query word `rah` is then an **exact equality** on a multikey index,
   not a regex scan. Compound index `(type, tokens, boost desc)` means MongoDB walks straight to the matching
   slice already ordered by popularity. Cost per word: O(log N + k).
3. **Multi-word queries** use `$all`, so every typed word must prefix some indexed word (`"zub qur"` → Zubin Qureshi).
4. **phonetic** = Soundex-style key per name word with Indian-English merges (sh→s, q/c→k, ph→f, ee→i, oo→u).
   Used only when the prefix stage returns fewer than 3 hits; results are flagged fuzzy and ranked lower.
5. **Ranking** happens in Python over at most 120 candidates per type (already the most popular ones):
   `score = boost + 6·exact | 4·name-starts-with | 2.5·all-words-prefix-in-order + proximity(≤1.5 within 30 km) − 2·fuzzy`.
   `boost` is static and precomputed at index time: `log1p(verified matches)` + CricHeroes link + photo for
   players, `log1p(members)` + CricHeroes for teams. Distance uses the haversine formula on the rounded point.
6. **Privacy at query time**: the caller is removed from their own results; `user_blocks` in either direction are
   excluded; deleted/suspended accounts and archived teams are never indexed. Player locations are rounded to
   3 decimals (~100 m) before indexing, so the index never holds a doorstep.
7. **Caching**: a 20 s in-process cache keyed by `(type, words)` absorbs keystroke bursts; the client debounces
   250 ms and cancels stale requests. The default (non-auth) rate limit applies.

### Keeping the index fresh
* **Write-through**: `UserService.update_me`, `PlayerService.upsert_me / update_cricheroes`,
  `TeamService.create / update / member accept / member remove`, and account deletion re-index the affected
  entity in the same request. New ground records call `index_venue`.
* **Safety net**: the scheduler calls `sync_recent` every tick (re-indexes anything with `updated_at` in the
  last few minutes; indexed on `updated_at`).
* **Rebuild**: `uv run python -m scripts.reindex_search` (idempotent); the API also fills an empty index at startup.

### Complexity and capacity
| Quantity | Value |
|---|---|
| Index entries per document | ≈ (avg word length × words) ≈ 25–40 tokens; ~1 KB per entity |
| 1,000,000 entities | ~1 GB index collection, ~300 MB `type_tokens_boost` index — fits an M10-class node in RAM |
| Query | 1–3 index seeks returning ≤120 docs each + O(120) scoring: p95 well under 50 ms independent of N |
| Writes | one `replace_one` per profile change; no fan-out |

### Scale path (no API change)
The module hides storage behind `SearchService`/`SearchIndexer`. When relevance needs BM25, synonyms or
typo-tolerance beyond Soundex, or the corpus passes ~5 M entities, point the same indexer at **MongoDB Atlas
Search** (Lucene, `autocomplete` + `fuzzy`) or **Meilisearch/Typesense** and keep `GET /search` identical.
The denormalised document is already the shape those engines want.

### API
`GET /api/v1/search?q=<text>&types=players,teams,grounds&lat&lng&limit` →
`{ query, players[ {id,name,role,area,city,image,verified_matches,has_cricheroes,cricheroes_profile_url,distance_km} ],
   teams[ {id,name,area,city,logo,member_count,has_cricheroes,looking_for_opponents,distance_km} ],
   grounds[ {id,name,address,area,city,lat,lng,distance_km} ] }`

Natural-language requests ("play on Saturday morning") remain on `POST /search/smart`; the app routes
sentence-like input there on submit and keeps name lookups on `GET /search` while typing.
