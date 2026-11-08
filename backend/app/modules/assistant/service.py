"""Smart search: natural-language request -> structured intent -> real candidates -> best options.

1. Interpret: Claude (structured output) when ANTHROPIC_API_KEY is set, otherwise the rule-based
   interpreter in ``interpret.py``.
2. Retrieve: only real, current data near the user (open pickup matches, the user's fixtures,
   available players, teams, communities). Nothing is invented.
3. Rank: deterministic score (time fit, distance, open spots, role, rating); Claude may then
   choose and explain the best options, but only from the candidate keys it was given, and every
   key is validated. The model never sees other users' names, contact details or coordinates.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId

from app.api.dependencies import CurrentUser
from app.common.types import GeoPointIn, approx_km, utcnow
from app.core.container import Container
from app.core.logging import get_logger
from app.modules.assistant.interpret import IST, rule_intent, today_ist, window_label, windows
from app.modules.assistant.schemas import Intent, SearchIn, SearchOut, SearchResultOut
from app.modules.competition.common import managed_team_ids, member_team_ids
from app.modules.competition.leaderboards import LeaderboardService

log = get_logger("assistant")
AI_SEARCHES_PER_MINUTE = 6
ROLE = {"batsman": "batter", "bowler": "bowler", "all_rounder": "all-rounder", "wicketkeeper": "wicketkeeper"}


@dataclass
class Cand:
    out: SearchResultOut
    score: float
    facts: str  # anonymised description for the model
    extra: dict[str, Any] = field(default_factory=dict)


def _fmt(dt: datetime) -> str:
    return (dt + IST).strftime("%a %-d %b, %-I:%M %p")


def _soon(start: datetime) -> float:
    """Small preference for sooner options (1.5 points per day ahead)."""
    return max(0.0, (start - utcnow()).total_seconds() / 86400) * 1.5


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _in(wins: list[tuple[datetime, datetime]], start: datetime, end: datetime | None = None) -> bool:
    end = end or start + timedelta(hours=3)
    return any(start < w1 and end > w0 for w0, w1 in wins)


class SmartSearch:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.lb = LeaderboardService(c)

    async def search(self, user: CurrentUser, data: SearchIn) -> SearchOut:
        use_ai = self.c.ai.enabled and self.c.limiter.hit(f"ai-search:{user.id}", AI_SEARCHES_PER_MINUTE)
        if self.c.ai.enabled and not use_ai:
            log.info("assistant.ai_throttled")
        intent: Intent | None = None
        if use_ai:
            parsed = await self.c.ai.interpret_search(data.query, today_ist().isoformat(), data.radius_km, Intent)
            intent = parsed if isinstance(parsed, Intent) else None
        engine = "claude" if intent else "rules"
        intent = intent or rule_intent(data.query)
        radius = intent.max_distance_km or data.radius_km
        at = GeoPointIn(lat=data.lat, lng=data.lng) if data.lat is not None and data.lng is not None else None
        try:
            origin = await self.lb._origin(user, at)  # noqa: SLF001
        except Exception:
            origin = None
        wins = windows(intent)
        cands: list[Cand] = []
        if origin:
            if intent.kind == "play_match":
                cands = await self._matches(user, origin, radius, wins, intent)
            elif intent.kind == "find_players":
                cands = await self._players(user, origin, radius, wins, intent)
            elif intent.kind in ("find_team", "find_opponent"):
                cands = await self._teams(user, origin, radius, intent)
            else:
                cands = await self._communities(user, origin, radius)
        cands.sort(key=lambda c: -c.score)
        cands = cands[:15]
        note: str | None = None
        results = [c.out for c in cands[:6]]
        if use_ai and engine == "claude" and cands:
            listing = "\n".join(f"c{i + 1}: {c.facts}" for i, c in enumerate(cands))
            ranking = await self.c.ai.rank_search(
                data.query, intent.summary + (f" ({window_label(intent, wins)})" if wins else ""), listing
            )
            if ranking is not None:
                keyed = {f"c{i + 1}": c for i, c in enumerate(cands)}
                picked = []
                for p in ranking.picks:
                    c = keyed.pop(p.key, None)
                    if c:
                        picked.append(c.out.model_copy(update={"reason": p.reason[:200]}))
                results = picked[:5] or results
                note = ranking.note[:200] if ranking.note else None
        if not origin:
            note = "Share your location or set a home area to search near you."
        elif not results:
            note = note or self._empty_note(intent, radius, bool(wins))
        return SearchOut(
            query=data.query,
            intent=intent.model_copy(update={"max_distance_km": radius}),
            window_label=window_label(intent, wins),
            results=results,
            engine=engine,
            note=note,
        )

    @staticmethod
    def _empty_note(intent: Intent, radius: int, timed: bool) -> str:
        what = {
            "play_match": "open games",
            "find_players": "available players",
            "find_team": "teams",
            "find_opponent": "teams to challenge",
            "find_community": "communities",
        }[intent.kind]
        return f"No {what} found within {radius} km{' at that time' if timed else ''}. Try a wider distance{' or a different day' if timed else ''}."  # noqa: E501

    # ------------------------------------------------------------ retrieval
    async def _matches(
        self, user: CurrentUser, origin: list[float], radius: int, wins: list[tuple[datetime, datetime]], intent: Intent
    ) -> list[Cand]:
        now = utcnow()
        q: dict[str, Any] = {
            "match_status": {"$in": ["published", "recruiting"]},
            "start_at": {"$gt": now, "$lt": now + timedelta(days=21)},
        }
        pipe: list[dict[str, Any]] = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": origin},
                    "distanceField": "d",
                    "maxDistance": radius * 1000,
                    "spherical": True,
                    "query": q,
                }
            },
            {"$limit": 80},
        ]
        rows = [m async for m in await self.c.mongo["matches"].aggregate(pipe)]
        teams = {
            t["_id"]: t
            async for t in self.c.mongo["teams"].find({"_id": {"$in": [m["team_id"] for m in rows]}}, {"team_name": 1})
        }
        mine = {
            r["match_id"]
            async for r in self.c.mongo["match_rosters"].find(
                {"player_id": user.id, "is_active": True}, {"match_id": 1}
            )
        }
        out: list[Cand] = []
        for m in rows:
            spots = max(0, m.get("squad_capacity", 0) - m.get("confirmed_count", 0))
            if not spots or m["_id"] in mine or m.get("captain_id") == user.id:
                continue
            fits = _in(wins, m["start_at"], m.get("end_at")) if wins else True
            if wins and not fits:
                continue
            km = approx_km(m["d"])
            fee = m.get("per_head_fee_paise") or 0
            team = teams.get(m["team_id"], {}).get("team_name", "Team")
            score = (
                (50 if wins else 20)
                - km * 2
                + min(spots, 6) * 2
                + (5 if not intent.format or m.get("format") == intent.format else -10)
                - _soon(m["start_at"])
            )
            out.append(
                Cand(
                    SearchResultOut(
                        kind="match",
                        id=str(m["_id"]),
                        title=m.get("title", "Pickup match"),
                        subtitle=f"{team} · {m.get('format', '')} · {spots} spot{'s' if spots != 1 else ''} open",
                        when=m["start_at"],
                        distance_km=km,
                        reason=f"{_fmt(m['start_at'])} · ~{km} km away · {spots} open spot{'s' if spots != 1 else ''}"
                        + (f" · ~₹{fee // 100} each" if fee else ""),
                        cta="Request to join",
                        image_name=team,
                    ),
                    score,
                    f"Pickup match '{m.get('title', '')}' by team '{team}', format {m.get('format')}, starts {_fmt(m['start_at'])}, ~{km} km away, {spots} open spots, fee about ₹{fee // 100} each",  # noqa: E501
                )
            )
        # the user's own team fixtures in the window
        teams_ids = list(await member_team_ids(self.c, user.id) | await managed_team_ids(self.c, user.id))
        if teams_ids and wins:
            fq = {
                "status": "scheduled",
                "$or": [{"home_team_id": {"$in": teams_ids}}, {"away_team_id": {"$in": teams_ids}}],
                "start_at": {"$gt": now},
            }
            async for f in self.c.mongo["fixtures"].find(fq).limit(20):
                if not _in(wins, f["start_at"]):
                    continue
                names = {
                    t["_id"]: t["team_name"]
                    async for t in self.c.mongo["teams"].find({"_id": {"$in": [f["home_team_id"], f["away_team_id"]]}})
                }
                title = f"{names.get(f['home_team_id'], '')} vs {names.get(f['away_team_id'], '')}"
                out.append(
                    Cand(
                        SearchResultOut(
                            kind="fixture",
                            id=str(f["_id"]),
                            title=title,
                            subtitle=f"{f['format'].replace('_', '-')} · {f['venue']['name']}",
                            when=f["start_at"],
                            distance_km=None,
                            reason=f"Already scheduled for your team: {_fmt(f['start_at'])} at {f['venue']['name']}",
                            cta="Open match",
                            image_name=names.get(f["home_team_id"]),
                        ),
                        62 - _soon(f["start_at"]),
                        f"Your own team's confirmed fixture '{title}', {_fmt(f['start_at'])}",
                    )
                )
        return out

    async def _players(
        self, user: CurrentUser, origin: list[float], radius: int, wins: list[tuple[datetime, datetime]], intent: Intent
    ) -> list[Cand]:
        at = GeoPointIn(lat=origin[1], lng=origin[0])
        found = await self.lb.nearby_players(user, at, radius, intent.role, None, False, None, "distance", limit=120)
        free: dict[str, tuple[datetime, datetime]] = {}
        if wins:
            uids = [ObjectId(p.user.id) for p in found]
            or_ = [{"start_at": {"$lt": w1}, "end_at": {"$gt": w0}} for w0, w1 in wins]
            async for a in self.c.mongo["availability"].find(
                {"player_id": {"$in": uids}, "status": "available", "$or": or_},
                {"player_id": 1, "start_at": 1, "end_at": 1},
            ):
                free.setdefault(str(a["player_id"]), (a["start_at"], a["end_at"]))
        out = []
        for p in found:
            slot = free.get(p.user.id)
            if wins and not slot:
                continue
            r = p.rating.rating if p.rating else None
            role = ROLE.get(p.primary_role or "", "player")
            when = (
                f"free {_fmt(slot[0])}–{(slot[1] + IST).strftime('%-I:%M %p')}"
                if slot
                else ("free this week" if p.available_this_week else "no availability set")
            )
            score = (
                (40 if slot else 10 if p.available_this_week else 0) - p.distance_km * 2 + ((r - 1400) / 20 if r else 0)
            )
            if intent.role and p.primary_role == intent.role:
                score += 15
            out.append(
                Cand(
                    SearchResultOut(
                        kind="player",
                        id=p.user.id,
                        title=p.user.full_name,
                        subtitle=f"{role.capitalize()} · ~{p.distance_km} km · {p.locality or p.user.city or ''}".strip(
                            " ·"
                        ),
                        when=slot[0] if slot else None,
                        distance_km=p.distance_km,
                        reason=f"{_cap(when)} · "
                        + (
                            f"rating {round(r)} from {p.verified_matches} verified matches"
                            if r
                            else "new, not rated yet"
                        ),
                        cta="View profile",
                        image_name=p.user.full_name,
                    ),
                    score,
                    f"Player: {role}, "
                    + (f"rating {round(r)} ({p.verified_matches} verified matches)" if r else "unrated")
                    + f", ~{p.distance_km} km away, {when}",
                )
            )
        return out

    async def _teams(self, user: CurrentUser, origin: list[float], radius: int, intent: Intent) -> list[Cand]:
        at = GeoPointIn(lat=origin[1], lng=origin[0])
        opp = intent.kind == "find_opponent"
        my = sorted(await managed_team_ids(self.c, user.id))
        teams = await self.lb.discover_teams(
            user,
            at,
            radius,
            my[0] if (opp and my) else None,
            None,
            None,
            intent.format,
            None,
            limit=40,
            purpose="challenge" if opp else "join",
        )
        out = []
        for t in teams:
            if not opp and t.my_membership:
                continue
            r = t.team.rating.rating if t.team.rating else None
            if opp:
                score = (
                    30
                    - t.distance_km
                    - (abs(t.rating_gap) / 25 if t.rating_gap is not None else 4)
                    - (20 if t.open_challenge_id else 0)
                )
                reason = f"~{t.distance_km} km away · " + (
                    f"rating {round(r)}"
                    + (
                        f" ({'+' if (t.rating_gap or 0) >= 0 else ''}{round(t.rating_gap)} vs yours)"
                        if t.rating_gap is not None
                        else ""
                    )
                    if r
                    else "not rated yet"
                )
                facts = (
                    f"Team '{t.team.team_name}', ~{t.distance_km} km away, "
                    + (f"rating {round(r)}, gap {t.rating_gap} vs user's team" if r else "unrated")
                    + (", already has an open challenge with user's team" if t.open_challenge_id else "")
                )
                cta = "Challenge"
            else:
                score = 30 - t.distance_km * 2 + min(t.open_spots, 8) * 3
                reason = (
                    f"~{t.distance_km} km away · "
                    + (f"{t.open_spots} open spots in upcoming games" if t.open_spots else "no open game right now")
                    + (f" · rating {round(r)}" if r else "")
                )
                facts = (
                    f"Team '{t.team.team_name}', ~{t.distance_km} km away, {t.member_count} members, {t.open_spots} open spots in upcoming pickup games"  # noqa: E501
                    + (f", rating {round(r)}" if r else ", unrated")
                )
                cta = "View team"
            out.append(
                Cand(
                    SearchResultOut(
                        kind="team",
                        id=t.team.id,
                        title=t.team.team_name,
                        subtitle=f"{t.team.area or ''} · {t.member_count} players".strip(" ·"),
                        when=None,
                        distance_km=t.distance_km,
                        reason=reason,
                        cta=cta,
                        image_name=t.team.team_name,
                    ),
                    score,
                    facts,
                )
            )
        return out

    async def _communities(self, user: CurrentUser, origin: list[float], radius: int) -> list[Cand]:
        from app.modules.communities.service import CommunityService

        coms = await CommunityService(self.c).discover(
            user, GeoPointIn(lat=origin[1], lng=origin[0]), max(radius, 20), None, None, None, False
        )
        return [
            Cand(
                SearchResultOut(
                    kind="community",
                    id=c.id,
                    title=c.name,
                    subtitle=f"{c.kind.capitalize()} · {c.member_count} members",
                    when=None,
                    distance_km=c.distance_km,
                    reason=f"{c.member_count} members · {c.team_count} teams"
                    + (f" · ~{c.distance_km} km" if c.distance_km is not None else "")
                    + (" · you're a member" if c.my_role else ""),
                    cta="Open",
                    image_name=c.name,
                ),
                c.member_count - (c.distance_km or 0) - (50 if c.my_role else 0),
                f"Community '{c.name}' ({c.kind}), {c.member_count} members, {c.visibility}",
            )
            for c in coms
        ]
