"""Location-based player and team leaderboards, player rating profiles, comparisons,
head-to-head records and the team leadership dashboard.

Ranking integrity
* Only ratings built from captain-verified fixture results appear here.
* Ranks use a conservative estimate (rating − 2·RD), so limited match history ranks lower
  until it is proven; every row shows its confidence and a provisional flag.
* Coordinates never leave the server: radius scopes return distance rounded to 0.5 km.
"""

import re
from datetime import timedelta
from typing import Any

from bson import ObjectId

from app.api.dependencies import CurrentUser
from app.common.enums import ResultStatus
from app.common.regions import cities_in_state, state_for_city
from app.common.response import PageParams
from app.common.types import GeoPointIn, approx_km, utcnow
from app.core.container import Container
from app.core.exceptions import NotFound, ValidationFailed
from app.modules.competition.achievements import MIN_ATTENDANCE, AttendanceOut, evaluate, metrics_from
from app.modules.competition.common import (
    managed_team_ids,
    member_team_ids,
    player_rating_brief,
    team_briefs,
    team_rating_brief,
    to_team_brief,
)
from app.modules.competition.fixtures import FixtureService
from app.modules.competition.schemas import (
    ContributionOut,
    DisciplineOut,
    HeadToHeadOut,
    LeaderboardMeta,
    NearbyPlayerOut,
    PlayerLeaderboardEntry,
    PlayerLeaderboardOut,
    PlayerRatingOut,
    RatingBrief,
    RatingHistoryOut,
    RosterEntry,
    TeamDashboardOut,
    TeamDiscoverEntry,
    TeamLeaderboardEntry,
    TeamLeaderboardOut,
)
from app.modules.cricheroes.urls import safe_profile_url
from app.modules.players.service import cricheroes_stats_out
from app.modules.rating_engine.composite import all_rounder_rating, confidence_from_rd
from app.modules.rating_engine.config import FORMAT_MIN_MATCHES, RISING_MIN_MATCHES, RISING_WINDOW_DAYS
from app.modules.rating_engine.explain import trend_summary
from app.modules.rating_engine.glicko2 import Glicko
from app.modules.users.schemas import public_user

RADIUS_KM = {"5km": 5, "10km": 10, "20km": 20, "50km": 50}
CANDIDATE_CAP = 5000
MIN_FOR_BOARD = 3
METHOD = (
    "Glicko-2 skill ratings from captain-verified results only, with cricket-specific batting, bowling and "
    "fielding scores weighted by playing role and adjusted for opposition strength. Ranked by rating − 2×RD."
)
TEAM_METHOD = "Glicko-2 team ratings from captain-verified results (win 1, tie ½, loss 0). Ranked by rating − 2×RD."
LABELS = {
    "overall": "Rating",
    "batting": "Batting",
    "bowling": "Bowling",
    "all_rounder": "All-round",
    "fielding": "Fielding",
    "consistency": "Consistency",
    "rising": "Gain (30 days)",
}
_DISC = {"batting": "bat", "bowling": "bowl", "fielding": "field"}


def _disc_out(d: dict[str, Any] | None) -> DisciplineOut:
    if not d:
        return DisciplineOut(rating=1500.0, rd=350.0, confidence=0.0, matches=0)
    return DisciplineOut(
        rating=round(d["r"], 1), rd=round(d["rd"], 1), confidence=confidence_from_rd(d["rd"]), matches=d["n"]
    )


class LeaderboardService:
    def __init__(self, c: Container) -> None:
        self.c = c

    # ---------------------------------------------------------------- scope
    async def _origin(self, user: CurrentUser, at: GeoPointIn | None) -> list[float]:
        if at:
            return [at.lng, at.lat]
        prof = await self.c.mongo["player_profiles"].find_one({"user_id": user.id}, {"home_location": 1})
        if prof and prof.get("home_location"):
            return list(prof["home_location"]["coordinates"])
        raise ValidationFailed(
            "Share your location or set a home area to see nearby rankings", code="LOCATION_REQUIRED"
        )

    async def _scope_users(
        self, user: CurrentUser, scope: str, at: GeoPointIn | None, city: str | None, state: str | None
    ) -> tuple[list[ObjectId] | None, dict[ObjectId, float], str]:
        """Returns (user ids or None for national, distances in metres, label)."""
        if scope in RADIUS_KM:
            origin = await self._origin(user, at)
            pipe: list[dict[str, Any]] = [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": origin},
                        "distanceField": "d",
                        "maxDistance": RADIUS_KM[scope] * 1000,
                        "spherical": True,
                    }
                },
                {"$limit": CANDIDATE_CAP},
                {"$project": {"user_id": 1, "d": 1}},
            ]
            dist = {p["user_id"]: p["d"] async for p in await self.c.mongo["player_profiles"].aggregate(pipe)}
            return list(dist), dist, f"Within {RADIUS_KM[scope]} km"
        if scope == "national":
            return None, {}, "India"
        my_city = city or user.doc.get("city")
        if scope == "city":
            if not my_city:
                raise ValidationFailed("Choose a city", code="CITY_REQUIRED")
            cities = [my_city.strip().casefold()]
            label = my_city.strip().title()
        else:
            st = state or state_for_city(my_city)
            if not st:
                raise ValidationFailed("Choose a state", code="STATE_REQUIRED")
            cities = cities_in_state(st)
            label = st
        pattern = "^(" + "|".join(map(_re_escape, cities)) + ")$"
        ids = [
            u["_id"]
            async for u in self.c.mongo["users"]
            .find({"city": {"$regex": pattern, "$options": "i"}, "account_status": {"$ne": "deleted"}}, {"_id": 1})
            .limit(CANDIDATE_CAP)
        ]
        return ids, {}, label

    # ---------------------------------------------------------------- players
    async def players(
        self,
        user: CurrentUser,
        scope: str,
        category: str,
        fmt: str | None,
        at: GeoPointIn | None,
        city: str | None,
        state: str | None,
        page: PageParams,
    ) -> PlayerLeaderboardOut:
        if fmt and category != "overall":
            raise ValidationFailed("Format rankings are available for the overall category", code="FORMAT_OVERALL_ONLY")
        ids, dist, label = await self._scope_users(user, scope, at, city, state)
        q: dict[str, Any] = {"matches": {"$gte": 1}}
        if ids is not None:
            q["user_id"] = {"$in": ids}
        if fmt:
            q[f"formats.{fmt}.matches"] = {"$gte": FORMAT_MIN_MATCHES}
        docs = [d async for d in self.c.mongo["player_ratings"].find(q).limit(CANDIDATE_CAP)]
        gains: dict[ObjectId, float] = {}
        if category == "rising":
            since = utcnow() - timedelta(days=RISING_WINDOW_DAYS)
            pipe: list[dict[str, Any]] = [
                {"$match": {"user_id": {"$in": [d["user_id"] for d in docs]}, "at": {"$gte": since}}},
                {"$sort": {"at": 1}},
                {"$group": {"_id": "$user_id", "start": {"$first": "$before.overall"}}},
            ]
            async for g in await self.c.mongo["player_rating_history"].aggregate(pipe):
                gains[g["_id"]] = g["start"]

        rows: list[dict[str, Any]] = []
        for d in docs:
            row = self._category_row(d, category, fmt, gains)
            if row:
                rows.append(row)
        rows.sort(key=lambda r: (-r["score"], -r["matches"], str(r["user_id"])))
        prev = sorted((r for r in rows if r["prev"] is not None), key=lambda r: (-r["prev"], str(r["user_id"])))
        prev_rank = {r["user_id"]: i + 1 for i, r in enumerate(prev)}
        for i, r in enumerate(rows):
            r["rank"] = i + 1
            pr = prev_rank.get(r["user_id"])
            r["movement"] = (pr - r["rank"]) if pr is not None and category != "rising" else None

        page_rows = rows[page.skip : page.skip + page.page_size]
        mine = next((r for r in rows if r["user_id"] == user.id), None)
        wanted = [r["user_id"] for r in page_rows] + ([mine["user_id"]] if mine else [])
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": wanted}})}
        profs = {
            p["user_id"]: p
            async for p in self.c.mongo["player_profiles"].find(
                {"user_id": {"$in": wanted}}, {"user_id": 1, "locality": 1, "primary_role": 1}
            )
        }

        def entry(r: dict[str, Any]) -> PlayerLeaderboardEntry | None:
            u = users.get(r["user_id"])
            if not u:
                return None
            p = profs.get(r["user_id"], {})
            m = dist.get(r["user_id"])
            return PlayerLeaderboardEntry(
                rank=r["rank"],
                movement=r["movement"],
                user=public_user(u),
                locality=p.get("locality"),
                distance_km=approx_km(m) if m is not None else None,
                primary_role=p.get("primary_role"),
                rating=round(r["display"], 1),
                rating_label=LABELS[category],
                rd=round(r["rd"], 1) if r["rd"] is not None else None,
                confidence=r["confidence"],
                provisional=r["provisional"],
                matches=r["matches"],
                trend=r["trend"],
            )

        data = [e for e in (entry(r) for r in page_rows) if e]
        return PlayerLeaderboardOut(
            data=data,
            me=entry(mine) if mine else None,
            meta=LeaderboardMeta(
                scope=scope,
                scope_label=label,
                category=category,
                format=fmt,
                total=len(rows),
                page=page.page,
                page_size=page.page_size,
                has_next=page.skip + len(page_rows) < len(rows),
                insufficient_data=len(rows) < MIN_FOR_BOARD,
                includes_demo_data=any(d.get("has_demo") for d in docs),
                method=METHOD,
            ),
        )

    @staticmethod
    def _category_row(
        d: dict[str, Any], category: str, fmt: str | None, gains: dict[ObjectId, float]
    ) -> dict[str, Any] | None:
        scores = d.get("scores") or {}
        prev = d.get("previous_scores") or {}
        o = d["overall"]
        base = {
            "user_id": d["user_id"],
            "matches": d["matches"],
            "trend": d.get("trend", [])[-8:],
            "provisional": o["provisional"],
            "confidence": o["confidence"],
            "rd": o["rd"],
        }
        if fmt:
            f = d["formats"][fmt]
            return {
                **base,
                "score": f["score"],
                "prev": f.get("previous_score"),
                "display": f["overall"]["rating"],
                "rd": f["overall"]["rd"],
                "confidence": f["overall"]["confidence"],
                "provisional": f["overall"]["provisional"],
                "matches": f["matches"],
            }
        if category == "overall":
            return {**base, "score": scores["overall"], "prev": prev.get("overall"), "display": o["rating"]}
        if category in _DISC:
            k = _DISC[category]
            disc = (d.get("disc") or {}).get(k)
            if not disc or scores.get(k) is None:
                return None
            return {
                **base,
                "score": scores[k],
                "prev": prev.get(k),
                "display": disc["r"],
                "rd": disc["rd"],
                "confidence": confidence_from_rd(disc["rd"]),
                "provisional": base["provisional"] or confidence_from_rd(disc["rd"]) < 0.55,
                "matches": disc["n"],
            }
        if category == "all_rounder":
            if scores.get("all_rounder") is None:
                return None
            bat, bowl = d["disc"]["bat"], d["disc"]["bowl"]
            rd = (bat["rd"] + bowl["rd"]) / 2
            return {
                **base,
                "score": scores["all_rounder"],
                "prev": prev.get("all_rounder"),
                "display": all_rounder_rating(Glicko(bat["r"]), Glicko(bowl["r"])),
                "rd": rd,
                "confidence": confidence_from_rd(rd),
            }
        if category == "consistency":
            c = scores.get("consistency")
            if c is None:
                return None
            return {**base, "score": c * 10_000 + o["conservative"] / 10, "prev": None, "display": c * 100, "rd": None}
        if category == "rising":
            start = gains.get(d["user_id"])
            if start is None or d["matches"] < RISING_MIN_MATCHES:
                return None
            gain = o["rating"] - start
            if gain <= 0:
                return None
            return {**base, "score": gain, "prev": None, "display": gain}
        raise ValidationFailed("Unknown category", code="INVALID_CATEGORY")

    async def city_rank(self, user_id: ObjectId, city: str | None) -> int | None:
        if not city:
            return None
        me = await self.c.mongo["player_ratings"].find_one({"user_id": user_id})
        if not me or not me.get("matches"):
            return None
        ids = [
            u["_id"]
            async for u in self.c.mongo["users"].find(
                {"city": {"$regex": f"^{_re_escape(city.strip())}$", "$options": "i"}}, {"_id": 1}
            )
        ]
        better = await self.c.mongo["player_ratings"].count_documents(
            {"user_id": {"$in": ids}, "matches": {"$gte": 1}, "scores.overall": {"$gt": me["scores"]["overall"]}}
        )
        return better + 1

    # ---------------------------------------------------------------- player profile
    async def player_rating(self, viewer: CurrentUser, uid: ObjectId) -> PlayerRatingOut:
        u = await self.c.mongo["users"].find_one({"_id": uid, "account_status": {"$ne": "deleted"}})
        if not u:
            raise NotFound("Player not found")
        prof = await self.c.mongo["player_profiles"].find_one({"user_id": uid}) or {}
        d = await self.c.mongo["player_ratings"].find_one({"user_id": uid})
        hist = [h async for h in self.c.mongo["player_rating_history"].find({"user_id": uid}).sort("at", -1).limit(200)]
        disc = (d or {}).get("disc") or {}
        brief = player_rating_brief(d) or RatingBrief(rating=1500.0, rd=350.0, confidence=0.0, provisional=True)
        career = _career(hist)
        summary = (
            trend_summary(hist[:5])
            if hist
            else ["No verified matches yet. Ratings start once a captain-verified result includes this player."]
        )
        bat, bowl = disc.get("bat"), disc.get("bowl")
        teams = await member_team_ids(self.c, uid)
        briefs = await team_briefs(self.c, teams)
        marks = [
            r["attendance"]
            async for r in self.c.mongo["match_rosters"].find(
                {"player_id": uid, "attendance": {"$in": ["present", "late", "no_show"]}}, {"attendance": 1}
            )
        ]
        attended = sum(1 for a in marks if a in ("present", "late"))
        attendance = AttendanceOut(
            attended=attended,
            marked=len(marks),
            rate=round(attended / len(marks), 2) if len(marks) >= MIN_ATTENDANCE else None,
        )
        return PlayerRatingOut(
            user=public_user(u),
            locality=prof.get("locality"),
            primary_role=prof.get("primary_role"),
            batting_style=prof.get("batting_style"),
            bowling_style=prof.get("bowling_style"),
            overall=brief,
            batting=_disc_out(bat),
            bowling=_disc_out(bowl),
            fielding=_disc_out(disc.get("field")),
            impact=_disc_out(disc.get("impact")),
            all_rounder_rating=round(all_rounder_rating(Glicko(bat["r"]), Glicko(bowl["r"])), 1)
            if bat and bowl
            else None,
            consistency=(d or {}).get("consistency"),
            verified_matches=(d or {}).get("matches", 0),
            formats={
                f: RatingBrief(**{k: v for k, v in fd["overall"].items() if k != "conservative"})
                for f, fd in ((d or {}).get("formats") or {}).items()
            },
            trend=(d or {}).get("trend", []),
            recent_form=(d or {}).get("impacts", []),
            local_rank=await self.city_rank(uid, u.get("city")),
            local_rank_city=u.get("city"),
            summary=summary,
            career=career,
            teams=list(briefs.values()),
            methodology=METHOD,
            includes_demo_data=bool((d or {}).get("has_demo")),
            achievements=evaluate(metrics_from(hist, career, attended)),
            cricheroes_profile_url=safe_profile_url(prof.get("cricheroes_url"), "player")[0],
            cricheroes_stats=cricheroes_stats_out(prof.get("cricheroes_stats")),
            bio=prof.get("bio"),
            cricheroes_player_id=safe_profile_url(prof.get("cricheroes_url"), "player")[1],
            attendance=attendance if marks else None,
        )

    async def history(self, viewer: CurrentUser, uid: ObjectId, page: PageParams) -> tuple[list[RatingHistoryOut], int]:
        q = {"user_id": uid}
        total = await self.c.mongo["player_rating_history"].count_documents(q)
        rows = [
            h
            async for h in self.c.mongo["player_rating_history"]
            .find(q)
            .sort("at", -1)
            .skip(page.skip)
            .limit(page.page_size)
        ]
        briefs = await team_briefs(self.c, {h["opponent_team_id"] for h in rows})
        return [
            RatingHistoryOut(
                fixture_id=str(h["fixture_id"]),
                at=h["at"],
                format=h["format"],
                opponent=briefs.get(h["opponent_team_id"]),
                result=h["result"],
                before=h["before"],
                after=h["after"],
                performance=h["performance"],
                reasons=h.get("reasons") or [],
                is_demo=bool(h.get("is_demo")),
            )
            for h in rows
        ], total

    # ---------------------------------------------------------------- teams
    async def _team_scope(
        self, user: CurrentUser, scope: str, at: GeoPointIn | None, city: str | None, state: str | None
    ) -> tuple[dict[ObjectId, dict[str, Any]], dict[ObjectId, float], str]:
        base = {"team_status": "active"}
        if scope in RADIUS_KM:
            origin = await self._origin(user, at)
            pipe: list[dict[str, Any]] = [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": origin},
                        "distanceField": "d",
                        "maxDistance": RADIUS_KM[scope] * 1000,
                        "spherical": True,
                        "query": base,
                    }
                },
                {"$limit": CANDIDATE_CAP},
            ]
            teams = {t["_id"]: t async for t in await self.c.mongo["teams"].aggregate(pipe)}
            return teams, {k: v["d"] for k, v in teams.items()}, f"Within {RADIUS_KM[scope]} km"
        q: dict[str, Any] = dict(base)
        label = "India"
        if scope in ("city", "state"):
            my_city = city or user.doc.get("city")
            if scope == "city":
                if not my_city:
                    raise ValidationFailed("Choose a city", code="CITY_REQUIRED")
                cities, label = [my_city.strip().casefold()], my_city.strip().title()
            else:
                st = state or state_for_city(my_city)
                if not st:
                    raise ValidationFailed("Choose a state", code="STATE_REQUIRED")
                cities, label = cities_in_state(st), st
            q["city"] = {"$regex": "^(" + "|".join(map(_re_escape, cities)) + ")$", "$options": "i"}
        teams = {t["_id"]: t async for t in self.c.mongo["teams"].find(q).limit(CANDIDATE_CAP)}
        return teams, {}, label

    def _team_entry(
        self, t: dict[str, Any], r: dict[str, Any], rank: int, movement: int | None, dist: float | None
    ) -> TeamLeaderboardEntry:
        brief = team_rating_brief(r)
        assert brief is not None
        played = r.get("played", 0)
        return TeamLeaderboardEntry(
            rank=rank,
            movement=movement,
            team=to_team_brief(t, r),
            distance_km=approx_km(dist) if dist is not None else None,
            rating=brief.rating,
            rd=brief.rd,
            confidence=brief.confidence,
            provisional=brief.provisional,
            matches=played,
            won=r.get("won", 0),
            lost=r.get("lost", 0),
            tied=r.get("tied", 0),
            win_pct=round(100 * r.get("won", 0) / played, 1) if played else None,
            form=(r.get("form") or [])[-5:],
        )

    async def teams(
        self,
        user: CurrentUser,
        scope: str,
        at: GeoPointIn | None,
        city: str | None,
        state: str | None,
        page: PageParams,
    ) -> TeamLeaderboardOut:
        teams, dist, label = await self._team_scope(user, scope, at, city, state)
        ratings = [
            r async for r in self.c.mongo["team_ratings"].find({"team_id": {"$in": list(teams)}, "played": {"$gte": 1}})
        ]
        ratings.sort(key=lambda r: (-r["conservative"], -r["played"], str(r["team_id"])))
        prev = sorted(
            (r for r in ratings if r.get("previous_conservative") is not None),
            key=lambda r: -r["previous_conservative"],
        )
        prev_rank = {r["team_id"]: i + 1 for i, r in enumerate(prev)}
        page_rows = ratings[page.skip : page.skip + page.page_size]
        data = []
        for i, r in enumerate(page_rows):
            rank = page.skip + i + 1
            pr = prev_rank.get(r["team_id"])
            data.append(
                self._team_entry(teams[r["team_id"]], r, rank, (pr - rank) if pr else None, dist.get(r["team_id"]))
            )
        return TeamLeaderboardOut(
            data=data,
            meta=LeaderboardMeta(
                scope=scope,
                scope_label=label,
                category="teams",
                format=None,
                total=len(ratings),
                page=page.page,
                page_size=page.page_size,
                has_next=page.skip + len(page_rows) < len(ratings),
                insufficient_data=len(ratings) < MIN_FOR_BOARD,
                includes_demo_data=any(r.get("has_demo") for r in ratings),
                method=TEAM_METHOD,
            ),
        )

    async def team_record(self, team_id: ObjectId) -> TeamLeaderboardEntry | None:
        t = await self.c.mongo["teams"].find_one({"_id": team_id})
        r = await self.c.mongo["team_ratings"].find_one({"team_id": team_id})
        if not t or not r or not r.get("played"):
            return None
        rank = await self.c.mongo["team_ratings"].count_documents({"conservative": {"$gt": r["conservative"]}}) + 1
        return self._team_entry(t, r, rank, None, None)

    async def team_city_rank(self, t: dict[str, Any], r: dict[str, Any] | None) -> int | None:
        if not r or not r.get("played") or not t.get("city"):
            return None
        ids = [
            x["_id"]
            async for x in self.c.mongo["teams"].find(
                {"city": {"$regex": f"^{_re_escape(t['city'].strip())}$", "$options": "i"}, "team_status": "active"},
                {"_id": 1},
            )
        ]
        return 1 + await self.c.mongo["team_ratings"].count_documents(
            {"team_id": {"$in": ids}, "played": {"$gte": 1}, "conservative": {"$gt": r["conservative"]}}
        )

    async def head_to_head(self, user: CurrentUser, a: ObjectId, b: ObjectId, last: int = 5) -> HeadToHeadOut:
        if a == b:
            raise ValidationFailed("Choose two different teams")
        briefs = await team_briefs(self.c, [a, b])
        if a not in briefs or b not in briefs:
            raise NotFound("Team not found")
        q = {
            "result.status": ResultStatus.CONFIRMED.value,
            "$or": [{"home_team_id": a, "away_team_id": b}, {"home_team_id": b, "away_team_id": a}],
        }
        rows = [f async for f in self.c.mongo["fixtures"].find(q).sort("start_at", -1)]
        a_w = sum(1 for f in rows if f["result"].get("winner_team_id") == a)
        b_w = sum(1 for f in rows if f["result"].get("winner_team_id") == b)
        tied = sum(1 for f in rows if f["result"]["result_type"] == "tied")
        nr = sum(1 for f in rows if f["result"]["result_type"] == "no_result")
        return HeadToHeadOut(
            team_a=briefs[a],
            team_b=briefs[b],
            played=len(rows),
            a_wins=a_w,
            b_wins=b_w,
            tied=tied,
            no_result=nr,
            last=await FixtureService(self.c).out_many(rows[:last], user),
        )

    async def nearby_players(
        self,
        user: CurrentUser,
        at: GeoPointIn | None,
        radius_km: int,
        role: str | None,
        min_rating: float | None,
        available: bool,
        q: str | None,
        sort: str,
        limit: int = 60,
    ) -> list[NearbyPlayerOut]:
        """Find a Player: everyone discoverable nearby, rated or not (finding is not ranking)."""
        origin = await self._origin(user, at)
        query: dict[str, Any] = {"user_id": {"$ne": user.id}, "availability_visibility": {"$ne": "private"}}
        if role:
            query["$or"] = [{"primary_role": role}, {"secondary_roles": role}]
        pipe: list[dict[str, Any]] = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": origin},
                    "distanceField": "d",
                    "maxDistance": radius_km * 1000,
                    "spherical": True,
                    "query": query,
                }
            },
            {"$limit": 500},
        ]
        profs = [p async for p in await self.c.mongo["player_profiles"].aggregate(pipe)]
        uids = [p["user_id"] for p in profs]
        uq: dict[str, Any] = {"_id": {"$in": uids}, "account_status": "active"}
        if q:
            uq["full_name"] = {"$regex": re.escape(q.strip()), "$options": "i"}
        users = {u["_id"]: u async for u in self.c.mongo["users"].find(uq)}
        ratings = {r["user_id"]: r async for r in self.c.mongo["player_ratings"].find({"user_id": {"$in": uids}})}
        now = utcnow()
        free: set[ObjectId] = {
            a["player_id"]
            async for a in self.c.mongo["availability"].find(
                {
                    "player_id": {"$in": uids},
                    "status": "available",
                    "start_at": {"$lt": now + timedelta(days=7)},
                    "end_at": {"$gt": now},
                },
                {"player_id": 1},
            )
        }
        member_rows = [
            m
            async for m in self.c.mongo["team_members"].find(
                {"user_id": {"$in": uids}, "status": "active"}, {"user_id": 1, "team_id": 1}
            )
        ]
        tnames = {
            t["_id"]: t["team_name"]
            async for t in self.c.mongo["teams"].find(
                {"_id": {"$in": list({m["team_id"] for m in member_rows})}}, {"team_name": 1}
            )
        }
        teams_of: dict[ObjectId, list[str]] = {}
        for m in member_rows:
            if m["team_id"] in tnames:
                teams_of.setdefault(m["user_id"], []).append(tnames[m["team_id"]])
        out: list[NearbyPlayerOut] = []
        for p in profs:
            u = users.get(p["user_id"])
            if not u:
                continue
            r = ratings.get(p["user_id"])
            brief = player_rating_brief(r)
            if min_rating is not None and (brief is None or brief.rating < min_rating):
                continue
            is_free = p["user_id"] in free
            if available and not is_free:
                continue
            out.append(
                NearbyPlayerOut(
                    user=public_user(u),
                    locality=p.get("locality"),
                    distance_km=approx_km(p["d"]),
                    primary_role=p.get("primary_role"),
                    secondary_roles=p.get("secondary_roles") or [],
                    batting_style=p.get("batting_style"),
                    bowling_style=p.get("bowling_style"),
                    rating=brief,
                    verified_matches=(r or {}).get("matches", 0),
                    available_this_week=is_free,
                    teams=teams_of.get(p["user_id"], [])[:3],
                    has_cricheroes=bool(safe_profile_url(p.get("cricheroes_url"), "player")[0]),
                )
            )
        if sort == "rating":
            out.sort(key=lambda e: (e.rating is None, -(e.rating.rating if e.rating else 0), e.distance_km))
        else:
            out.sort(key=lambda e: (e.distance_km, not e.available_this_week))
        return out[:limit]

    async def discover_teams(
        self,
        user: CurrentUser,
        at: GeoPointIn | None,
        radius_km: int,
        from_team: ObjectId | None,
        min_rating: float | None,
        max_rating: float | None,
        fmt: str | None,
        q: str | None,
        limit: int = 30,
        purpose: str = "challenge",
        recruiting: bool = False,
    ) -> list[TeamDiscoverEntry]:
        origin = await self._origin(user, at)
        mine = await member_team_ids(self.c, user.id) | await managed_team_ids(self.c, user.id)
        query: dict[str, Any] = {"team_status": "active"}
        if purpose == "challenge":
            query["_id"] = {"$nin": list(mine)}
        if fmt:
            query["$or"] = [
                {"preferred_formats": fmt},
                {"preferred_formats": {"$in": [None, []]}},
                {"preferred_formats": {"$exists": False}},
            ]
        if q:
            query["team_name"] = {"$regex": _re_escape(q.strip()), "$options": "i"}
        pipe: list[dict[str, Any]] = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": origin},
                    "distanceField": "d",
                    "maxDistance": radius_km * 1000,
                    "spherical": True,
                    "query": query,
                }
            },
            {"$limit": 200},
        ]
        teams = [t async for t in await self.c.mongo["teams"].aggregate(pipe)]
        ids = [t["_id"] for t in teams]
        ratings = {r["team_id"]: r async for r in self.c.mongo["team_ratings"].find({"team_id": {"$in": ids}})}
        my_rating = None
        if from_team:
            mr = await self.c.mongo["team_ratings"].find_one({"team_id": from_team})
            my_rating = mr["rating"] if mr and mr.get("played") else None
        open_ch: dict[ObjectId, ObjectId] = {}
        if from_team:
            async for ch in self.c.mongo["team_challenges"].find(
                {
                    "status": {"$in": ["draft", "pending", "accepted", "counter_proposed", "confirmed"]},
                    "$or": [
                        {"from_team_id": from_team, "to_team_id": {"$in": ids}},
                        {"to_team_id": from_team, "from_team_id": {"$in": ids}},
                    ],
                }
            ):
                other = ch["to_team_id"] if ch["from_team_id"] == from_team else ch["from_team_id"]
                open_ch[other] = ch["_id"]
        caps = {
            u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": [t["captain_id"] for t in teams]}})
        }
        spots: dict[ObjectId, tuple[int, str | None]] = {}
        next_match: dict[ObjectId, dict[str, Any]] = {}
        async for m in (
            self.c.mongo["matches"]
            .find(
                {
                    "team_id": {"$in": ids},
                    "match_status": {"$in": ["published", "recruiting"]},
                    "start_at": {"$gt": utcnow()},
                },
                {
                    "team_id": 1,
                    "squad_capacity": 1,
                    "confirmed_count": 1,
                    "start_at": 1,
                    "format": 1,
                    "required_roles": 1,
                },
            )
            .sort("start_at", 1)
        ):
            open_ = max(0, m.get("squad_capacity", 0) - m.get("confirmed_count", 0))
            cur = spots.get(m["team_id"], (0, None))
            spots[m["team_id"]] = (cur[0] + open_, cur[1] or (str(m["_id"]) if open_ else None))
            if open_ and m["team_id"] not in next_match:
                next_match[m["team_id"]] = m
        role_fill: dict[ObjectId, dict[str, int]] = {}
        if next_match:
            async for ro in self.c.mongo["match_rosters"].find(
                {"match_id": {"$in": [m["_id"] for m in next_match.values()]}, "is_active": True},
                {"match_id": 1, "assigned_role": 1},
            ):
                if ro.get("assigned_role"):
                    d = role_fill.setdefault(ro["match_id"], {})
                    d[ro["assigned_role"]] = d.get(ro["assigned_role"], 0) + 1
        my_status = {
            m["team_id"]: (m["member_role"] if m["status"] == "active" else m["status"])
            async for m in self.c.mongo["team_members"].find(
                {"team_id": {"$in": ids}, "user_id": user.id, "status": {"$in": ["active", "invited", "requested"]}}
            )
        }
        out = []
        for t in teams:
            r = ratings.get(t["_id"])
            rated = r["rating"] if r and r.get("played") else None
            if min_rating is not None and (rated is None or rated < min_rating):
                continue
            if max_rating is not None and (rated is None or rated > max_rating):
                continue
            if purpose == "challenge" and t.get("looking_for_opponents") is False:
                continue
            cap = caps.get(t["captain_id"])
            if not cap:
                continue
            nm: dict[str, Any] | None = next_match.get(t["_id"])
            out.append(
                TeamDiscoverEntry(
                    team=to_team_brief(t, r),
                    distance_km=approx_km(t["d"]),
                    captain=public_user(cap),
                    member_count=t.get("member_count", 0),
                    rating_gap=round(rated - my_rating, 1) if rated is not None and my_rating is not None else None,
                    open_challenge_id=str(open_ch[t["_id"]]) if t["_id"] in open_ch else None,
                    open_spots=spots.get(t["_id"], (0, None))[0],
                    next_open_match_id=spots.get(t["_id"], (0, None))[1],
                    next_open_match_at=nm["start_at"] if nm else None,
                    next_open_match_format=nm.get("format") if nm else None,
                    open_roles={
                        k: v - role_fill.get(nm["_id"], {}).get(k, 0)
                        for k, v in (nm.get("required_roles") or {}).items()
                        if v - role_fill.get(nm["_id"], {}).get(k, 0) > 0
                    }
                    if nm
                    else {},
                    my_membership=my_status.get(t["_id"]),
                )
            )
        if recruiting:
            out = [e for e in out if e.open_spots > 0]
        if my_rating is not None:
            out.sort(key=lambda e: (e.rating_gap is None, abs(e.rating_gap or 0), e.distance_km))
        return out[:limit]

    async def dashboard(self, user: CurrentUser, team_id: ObjectId) -> TeamDashboardOut:
        from app.modules.competition.challenges import ChallengeService

        t = await self.c.mongo["teams"].find_one({"_id": team_id, "team_status": "active"})
        if not t:
            raise NotFound("Team not found")
        r = await self.c.mongo["team_ratings"].find_one({"team_id": team_id})
        is_manager = t["captain_id"] == user.id or user.id in (t.get("admin_ids") or [])
        cap = await self.c.mongo["users"].find_one({"_id": t["captain_id"]}) or {
            "_id": t["captain_id"],
            "full_name": "Captain",
        }
        my = await self.c.mongo["team_members"].find_one({"team_id": team_id, "user_id": user.id})
        membership = (
            my["status"]
            if my and my["status"] in ("invited", "requested")
            else (my["member_role"] if my and my["status"] == "active" else None)
        )

        statuses = ["active", "invited", "requested"] if is_manager else ["active"]
        rows = [m async for m in self.c.mongo["team_members"].find({"team_id": team_id, "status": {"$in": statuses}})]
        uids = [m["user_id"] for m in rows]
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find({"_id": {"$in": uids}, "account_status": {"$ne": "deleted"}})
        }
        profs = {p["user_id"]: p async for p in self.c.mongo["player_profiles"].find({"user_id": {"$in": uids}})}
        prs = {p["user_id"]: p async for p in self.c.mongo["player_ratings"].find({"user_id": {"$in": uids}})}
        now = utcnow()
        avail: dict[ObjectId, bool] = {}
        async for s in self.c.mongo["availability"].find(
            {"player_id": {"$in": uids}, "start_at": {"$lt": now + timedelta(days=7)}, "end_at": {"$gt": now}},
            {"player_id": 1, "status": 1},
        ):
            avail[s["player_id"]] = avail.get(s["player_id"], False) or s.get("status") == "available"
        order = {"captain": 0, "admin": 1, "member": 2}

        def entry(m: dict[str, Any]) -> RosterEntry | None:
            u = users.get(m["user_id"])
            if not u:
                return None
            return RosterEntry(
                user=public_user(u),
                member_role=m["member_role"],
                member_status=m["status"],
                primary_role=profs.get(m["user_id"], {}).get("primary_role"),
                rating=player_rating_brief(prs.get(m["user_id"])),
                available_next_7_days=avail.get(m["user_id"]),
            )

        roster = [e for m in rows if m["status"] != "requested" and (e := entry(m))]
        roster.sort(
            key=lambda e: (
                e.member_status != "active",
                order.get(e.member_role, 3),
                -(e.rating.rating if e.rating else 0),
            )
        )
        requests = [e for m in rows if m["status"] == "requested" and (e := entry(m))]

        fx = FixtureService(self.c)
        upcoming = await fx.list_for_teams(user, {team_id}, "upcoming", 10)
        recent = await fx.list_for_teams(user, {team_id}, "past", 10)
        awaiting = await fx.list_for_teams(user, {team_id}, "awaiting", 10)
        challenges = []
        if is_manager:
            challenges = await ChallengeService(self.c).list(user, "all", "active", team_id)

        contrib: dict[ObjectId, dict[str, Any]] = {}
        async for h in self.c.mongo["player_rating_history"].find({"team_id": team_id}):
            c = contrib.setdefault(h["user_id"], {"matches": 0, "runs": 0, "wickets": 0, "catches": 0, "impact": []})
            c["matches"] += 1
            lines = h.get("lines") or {}
            c["runs"] += (lines.get("bat") or {}).get("runs", 0)
            c["wickets"] += (lines.get("bowl") or {}).get("wickets", 0)
            c["catches"] += (lines.get("field") or {}).get("catches", 0)
            if (h.get("performance") or {}).get("impact") is not None:
                c["impact"].append(h["performance"]["impact"])
        cu = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": list(contrib)}})}
        contributions = sorted(
            (
                ContributionOut(
                    user=public_user(cu[k]),
                    matches=v["matches"],
                    runs=v["runs"],
                    wickets=v["wickets"],
                    catches=v["catches"],
                    impact=round(sum(v["impact"]) / len(v["impact"]), 3) if v["impact"] else None,
                )
                for k, v in contrib.items()
                if k in cu
            ),
            key=lambda c: -(c.impact or 0),
        )[:15]

        opp_counts: dict[ObjectId, int] = {}
        for f in recent:
            other = ObjectId(f.away_team.id if f.home_team.id == str(team_id) else f.home_team.id)
            opp_counts[other] = opp_counts.get(other, 0) + 1
        h2h = [
            await self.head_to_head(user, team_id, o, last=3)
            for o in sorted(opp_counts, key=lambda o: -opp_counts[o])[:3]
        ]

        streak = (r or {}).get("streak")
        ch_url, ch_id = safe_profile_url(t.get("cricheroes_team_url"), "team")
        return TeamDashboardOut(
            team=to_team_brief(t, r),
            description=t.get("description"),
            cricheroes_team_url=ch_url,
            cricheroes_team_id=ch_id,
            captain=public_user(cap),
            can_manage=is_manager,
            is_captain=t["captain_id"] == user.id,
            my_membership=membership,
            looking_for_opponents=t.get("looking_for_opponents", True),
            rank_city=await self.team_city_rank(t, r),
            record=await self.team_record(team_id),
            streak=f"{streak['count']}{streak['kind']}" if streak else None,
            rating_history=(r or {}).get("trend", []),
            roster=roster,
            join_requests=requests,
            upcoming=upcoming,
            recent=recent,
            awaiting_action=awaiting,
            challenges=challenges,
            contributions=contributions,
            head_to_head=h2h,
            includes_demo_data=bool((r or {}).get("has_demo")),
        )


def _re_escape(s: str) -> str:
    return re.escape(s)


def _career(hist: list[dict[str, Any]]) -> dict[str, float]:
    runs = balls = outs = fours = sixes = wk = bb = rc = catches = ro = st = innings = 0
    best_bat = 0
    for h in hist:
        lines = h.get("lines") or {}
        if b := lines.get("bat"):
            innings += 1
            runs += b["runs"]
            balls += b["balls"]
            outs += 1 if b["out"] else 0
            fours += b.get("fours", 0)
            sixes += b.get("sixes", 0)
            best_bat = max(best_bat, b["runs"])
        if w := lines.get("bowl"):
            wk += w["wickets"]
            bb += w["balls"]
            rc += w["runs"]
        if f := lines.get("field"):
            catches += f.get("catches", 0)
            ro += f.get("run_outs", 0)
            st += f.get("stumpings", 0)
    out: dict[str, float] = {
        "matches": len(hist),
        "innings": innings,
        "runs": runs,
        "highest": best_bat,
        "fours": fours,
        "sixes": sixes,
        "wickets": wk,
        "catches": catches,
        "run_outs": ro,
        "stumpings": st,
    }
    if outs:
        out["batting_average"] = round(runs / outs, 2)
    if balls:
        out["strike_rate"] = round(100 * runs / balls, 1)
    if bb:
        out["economy"] = round(6 * rc / bb, 2)
    if wk:
        out["bowling_average"] = round(rc / wk, 2)
    return out
