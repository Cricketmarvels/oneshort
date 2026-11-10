"""Unified search over players, teams and grounds.

Query path (per requested type), all served by indexes on ``search_index``:

1. Tokenise the query the same way names were indexed.
2. Prefix stage: ``{type, tokens: {$all: [w1, w2, …]}}`` — every query word must be a prefix of some
   indexed word. The multikey index ``(type, tokens, boost)`` turns this into index seeks returning
   candidates already ordered by popularity; we read at most CANDIDATES per type.
3. If the prefix stage finds fewer than FUZZY_BELOW hits, a phonetic stage adds names whose Soundex key
   matches (spelling variants), marked as fuzzy so they rank below exact prefixes.
4. Score in-process over that bounded candidate set: exact name > name starts with query > every word is a
   word-prefix in order > popularity boost > proximity to the searcher; fuzzy hits carry a penalty.
5. Blocked users (either direction) are removed from player results.

Cost is O(log N + k) in the index plus O(k) scoring with k ≤ CANDIDATES, independent of collection size,
so it holds as users/teams/grounds grow; see docs/design/SEARCH_AND_MEDIA.md for the scale path.
"""

import math
from dataclasses import dataclass
from typing import Any, Literal

from bson import ObjectId

from app.api.dependencies import CurrentUser
from app.common.types import approx_km
from app.core.container import Container
from app.modules.search.cache import candidate_cache as _cache
from app.modules.search.indexer import COLLECTION
from app.modules.search.text import normalise, soundex, words

SearchType = Literal["player", "team", "ground"]
ALL_TYPES: tuple[SearchType, ...] = ("player", "team", "ground")
CANDIDATES = 120
FUZZY_BELOW = 3


@dataclass
class Hit:
    doc: dict[str, Any]
    score: float
    distance_km: float | None


def _haversine_km(a: list[float], b: list[float]) -> float:
    (lng1, lat1), (lng2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


class SearchService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo[COLLECTION]

    async def _candidates(self, kind: SearchType, qwords: list[str]) -> list[dict[str, Any]]:
        key = (kind, tuple(qwords))
        cached = _cache.get(key)
        if cached is not None:
            return cached
        rows = [
            r
            async for r in self.col.find({"type": kind, "tokens": {"$all": qwords}}).sort("boost", -1).limit(CANDIDATES)
        ]
        if len(rows) < FUZZY_BELOW:
            keys = [k for k in (soundex(w) for w in qwords if len(w) >= 3) if k]
            if keys:
                seen = {r["_id"] for r in rows}
                async for r in self.col.find({"type": kind, "phonetic": {"$in": keys}}).sort("boost", -1).limit(40):
                    if r["_id"] not in seen:
                        r["_fuzzy"] = True
                        rows.append(r)
        _cache.put(key, rows)
        return rows

    @staticmethod
    def _score(doc: dict[str, Any], q: str, qwords: list[str], origin: list[float] | None) -> Hit:
        name = doc["name_norm"]
        nwords = name.split()
        s = float(doc.get("boost") or 0)
        if name == q:
            s += 6
        elif name.startswith(q):
            s += 4
        else:
            # every query word is a prefix of a name word, in order → strong; otherwise matched via area/city only
            i = 0
            for w in qwords:
                while i < len(nwords) and not nwords[i].startswith(w):
                    i += 1
                if i == len(nwords):
                    break
                i += 1
            else:
                s += 2.5
        if doc.get("_fuzzy"):
            s -= 2
        dist = None
        loc = doc.get("loc")
        if origin and loc:
            dist = approx_km(_haversine_km(origin, loc["coordinates"]) * 1000)
            s += max(0.0, 1.5 - (dist or 0) / 20)  # within 30 km earns up to 1.5
        return Hit(doc, s, dist)

    async def _blocked(self, me: ObjectId) -> set[ObjectId]:
        out: set[ObjectId] = set()
        async for b in self.c.mongo["user_blocks"].find({"$or": [{"user_id": me}, {"blocked_id": me}]}):
            out.add(b["blocked_id"] if b["user_id"] == me else b["user_id"])
        return out

    async def search(
        self,
        user: CurrentUser,
        query: str,
        types: tuple[SearchType, ...],
        lat: float | None,
        lng: float | None,
        limit: int,
    ) -> dict[SearchType, list[Hit]]:
        q = normalise(query)
        qwords = words(query)[:6]
        out: dict[SearchType, list[Hit]] = {}
        if not qwords:
            return {t: [] for t in types}
        origin = [lng, lat] if lat is not None and lng is not None else None
        blocked = await self._blocked(user.id) if "player" in types else set()
        for kind in types:
            rows = await self._candidates(kind, qwords)
            hits = [
                self._score(r, q, qwords, origin)
                for r in rows
                if not (kind == "player" and (r["entity_id"] in blocked or r["entity_id"] == user.id))
            ]
            hits.sort(key=lambda h: (-h.score, h.doc["name_norm"]))
            out[kind] = hits[:limit]
        return out
