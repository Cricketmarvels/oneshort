"""Hyperlocal discovery: Find a Player (captains) and Find a Team (players).

Pipeline for Find a Player (origin = match venue):
1. ``$geoNear`` on ``availability.location`` with ``maxDistance = radius``: HARD constraint.
   The query also requires a real time overlap with the match window (not just the date)
   and discoverable visibility.
2. Drop slots farther than the player's own ``max_travel_km``.
3. Group per player; join profile + user; drop inactive/restricted/agreement-missing users,
   already invited/seated players and the searcher.
4. Compute coverage of the match window; enforce full (or ≥50% with allow_partial) coverage.
5. Role and min-rating filters; then the ``Ranker`` orders the eligible set.
"""

from typing import Any

from bson import ObjectId

from app.api.dependencies import CurrentUser, latest_material_version
from app.common.enums import AvailabilityStatus, MatchStatus
from app.common.response import PageMeta
from app.common.types import approx_km, ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, ValidationFailed
from app.modules.availability.overlap import merged_coverage
from app.modules.discovery.ranking import Candidate, Ranker, RoleMatch, WeightedRanker
from app.modules.discovery.schemas import (
    OpportunityOut,
    PlayerResultOut,
    PlayerSearchIn,
    PlayerSearchMeta,
    PlayerSearchOut,
    TeamBrief,
    TeamSearchIn,
    TeamSearchOut,
)
from app.modules.matches import lifecycle
from app.modules.matches.service import ROLES, MatchAccess
from app.modules.players.service import DEFAULT_RELIABILITY
from app.modules.users.schemas import public_user


class DiscoveryService:
    def __init__(self, c: Container, ranker: Ranker | None = None) -> None:
        self.c = c
        self.ranker = ranker or WeightedRanker(c.settings.ranking)
        self.access = MatchAccess(c)

    # ============================================================ players
    async def find_players(self, user: CurrentUser, req: PlayerSearchIn) -> PlayerSearchOut:
        excluded: set[ObjectId] = {user.id}
        team_id: ObjectId | None = None
        if req.match_id:
            match, _ = await self.access.load_managed(ObjectId(req.match_id), user)
            if MatchStatus(match["match_status"]) in lifecycle.TERMINAL:
                raise BusinessRuleViolation("This match is closed", code="MATCH_CLOSED")
            start, end = ensure_utc(match["start_at"]), ensure_utc(match["end_at"])
            origin = match["location"]
            team_id = match["team_id"]
            excluded |= {
                i["player_id"]
                async for i in self.c.mongo["invitations"].find(
                    {"match_id": match["_id"], "is_active": True}, {"player_id": 1}
                )
            }
            excluded |= {
                r["player_id"]
                async for r in self.c.mongo["match_rosters"].find(
                    {"match_id": match["_id"], "is_active": True}, {"player_id": 1}
                )
            }
        else:
            assert req.start_at and req.end_at and req.location
            start, end, origin = req.start_at, req.end_at, req.location.to_geojson()
        if int(req.radius_km) not in self.c.settings.discovery_allowed_radii_km:
            raise ValidationFailed("Unsupported radius")
        radius_m = int(req.radius_km) * 1000
        statuses = [AvailabilityStatus.AVAILABLE.value]
        if req.include_tentative:
            statuses.append(AvailabilityStatus.TENTATIVE.value)

        pipeline: list[dict[str, Any]] = [
            {
                "$geoNear": {
                    "near": origin,
                    "key": "location",
                    "distanceField": "distance_m",
                    "spherical": True,
                    "maxDistance": radius_m,
                    "query": {
                        "status": {"$in": statuses},
                        "visibility": "discoverable",
                        "start_at": {"$lt": end},
                        "end_at": {"$gt": start},
                        "player_id": {"$nin": list(excluded)},
                    },
                }
            },
            {"$match": {"$expr": {"$lte": ["$distance_m", {"$multiply": ["$max_travel_km", 1000]}]}}},
            {
                "$group": {
                    "_id": "$player_id",
                    "distance_m": {"$min": "$distance_m"},
                    "slots": {"$push": {"s": "$start_at", "e": "$end_at", "st": "$status"}},
                }
            },
            {"$limit": self.c.settings.discovery_candidate_cap},
            {"$lookup": {"from": "player_profiles", "localField": "_id", "foreignField": "user_id", "as": "p"}},
            {"$unwind": "$p"},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "_id",
                    "foreignField": "_id",
                    "as": "u",
                    "pipeline": [
                        {
                            "$project": {
                                "full_name": 1,
                                "profile_image": 1,
                                "city": 1,
                                "account_status": 1,
                                "agreement_version_accepted": 1,
                            }
                        }
                    ],
                }
            },
            {"$unwind": "$u"},
            {"$match": {"u.account_status": "active"}},
            {"$project": {"p.home_location": 0, "p._lock": 0}},
        ]
        rows = [r async for r in await self.c.mongo["availability"].aggregate(pipeline)]

        required_version = await latest_material_version(self.c)
        members: set[ObjectId] = set()
        with_team: dict[ObjectId, int] = {}
        if team_id:
            members = {
                m["user_id"]
                async for m in self.c.mongo["team_members"].find(
                    {"team_id": team_id, "status": "active"}, {"user_id": 1}
                )
            }
            past = [
                m["_id"]
                async for m in self.c.mongo["matches"].find(
                    {"team_id": team_id, "match_status": "completed"}, {"_id": 1}
                )
            ]
            async for r in await self.c.mongo["match_rosters"].aggregate(
                [
                    {"$match": {"match_id": {"$in": past}, "attendance": {"$in": ["present", "late"]}}},
                    {"$group": {"_id": "$player_id", "n": {"$sum": 1}}},
                ]
            ):
                with_team[r["_id"]] = r["n"]

        min_cov = self.c.settings.discovery_partial_overlap_min if req.allow_partial else 0.999
        wanted = {r.value for r in req.roles}
        candidates: list[Candidate] = []
        by_id: dict[str, dict[str, Any]] = {}
        matched: dict[str, str | None] = {}
        supply: dict[str, int] = dict.fromkeys(wanted, 0)
        for r in rows:
            u, p = r["u"], r["p"]
            if required_version is not None and (u.get("agreement_version_accepted") or 0) < required_version:
                continue
            slots = [(ensure_utc(s["s"]), ensure_utc(s["e"])) for s in r["slots"]]
            coverage = merged_coverage(slots, start, end)
            if coverage < min_cov:
                continue
            role_match: RoleMatch
            if not wanted:
                role_match = "any"
            elif p["primary_role"] in wanted:
                role_match = "primary"
            elif wanted & set(p.get("secondary_roles") or []):
                role_match = "secondary"
            else:
                continue
            if req.min_rating and (p.get("average_rating") or 0) < req.min_rating:
                continue
            if wanted:
                fills = (
                    p["primary_role"]
                    if p["primary_role"] in wanted
                    else next((x for x in p.get("secondary_roles") or [] if x in wanted), None)
                )
                matched[str(r["_id"])] = fills
                if fills:
                    supply[fills] += 1
            stats = p.get("stats") or {}
            received = stats.get("invitations_received", 0)
            cand = Candidate(
                player_id=str(r["_id"]),
                distance_m=r["distance_m"],
                radius_m=radius_m,
                coverage=coverage,
                role_match=role_match,
                avg_rating=p.get("average_rating"),
                rating_count=p.get("rating_count", 0),
                reliability=p.get("reliability_score", DEFAULT_RELIABILITY),
                matches_played=stats.get("matches_played", 0),
                played_with_team=with_team.get(r["_id"], 0),
                response_rate=(stats.get("invitations_responded", 0) / received) if received else None,
                tentative=all(s["st"] == "tentative" for s in r["slots"]),
            )
            candidates.append(cand)
            by_id[cand.player_id] = r

        ranked = self.ranker.rank(candidates)
        total = len(ranked)
        page = ranked[(req.page - 1) * req.page_size : req.page * req.page_size]
        data = []
        for s in page:
            r = by_id[s.candidate.player_id]
            p = r["p"]
            data.append(
                PlayerResultOut(
                    player=public_user({**r["u"], "_id": r["_id"]}),
                    primary_role=p["primary_role"],
                    secondary_roles=p.get("secondary_roles") or [],
                    role_match=s.candidate.role_match if s.candidate.role_match != "none" else "any",
                    matched_role=matched.get(s.candidate.player_id),
                    batting_style=p.get("batting_style"),
                    bowling_style=p.get("bowling_style"),
                    experience_years=p.get("experience_years"),
                    approx_distance_km=approx_km(s.candidate.distance_m),
                    availability_status="tentative" if s.candidate.tentative else "available",
                    coverage=round(s.candidate.coverage, 2),
                    average_rating=p.get("average_rating"),
                    rating_count=p.get("rating_count", 0),
                    reliability_score=s.candidate.reliability,
                    matches_played=s.candidate.matches_played,
                    is_team_member=r["_id"] in members,
                    score=s.score,
                    score_breakdown=s.factors,
                )
            )
        return PlayerSearchOut(
            data=data,
            meta=PlayerSearchMeta(
                page=req.page,
                page_size=req.page_size,
                total=total,
                has_next=req.page * req.page_size < total,
                radius_km=int(req.radius_km),
                ranker=self.ranker.name,
                players_needed=req.players_needed,
                role_counts={k.value: v for k, v in req.role_counts.items()},
                role_supply=supply,
            ),
        )

    # ============================================================== teams
    async def find_teams(self, user: CurrentUser, req: TeamSearchIn) -> TeamSearchOut:
        if req.location is not None:
            origin = req.location.to_geojson()
        else:
            prof = await self.c.mongo["player_profiles"].find_one({"user_id": user.id}, {"home_location": 1})
            if not prof or not prof.get("home_location"):
                raise ValidationFailed("Share your location or pick an area to search", code="LOCATION_REQUIRED")
            origin = prof["home_location"]
        radius_m = int(req.radius_km) * 1000
        now = utcnow()
        q: dict[str, Any] = {
            "match_status": {"$in": [s.value for s in lifecycle.DISCOVERABLE]},
            "start_at": {"$gte": max(now, req.start_at) if req.start_at else now},
            "captain_id": {"$ne": user.id},
            "$expr": {"$lt": ["$confirmed_count", "$squad_capacity"]},
        }
        if req.end_at:
            q["end_at"] = {"$lte": req.end_at}
        if req.format:
            q["format"] = req.format.value
        if req.category:
            q["category"] = req.category.value
        if req.max_fee_paise is not None:
            q["per_head_fee_paise"] = {"$lte": req.max_fee_paise}
        rows = [
            m
            async for m in await self.c.mongo["matches"].aggregate(
                [
                    {
                        "$geoNear": {
                            "near": origin,
                            "key": "location",
                            "distanceField": "distance_m",
                            "spherical": True,
                            "maxDistance": radius_m,
                            "query": q,
                        }
                    },
                    {"$limit": self.c.settings.discovery_candidate_cap},
                ]
            )
        ]
        if req.use_my_availability:
            slots = [
                (ensure_utc(a["start_at"]), ensure_utc(a["end_at"]))
                async for a in self.c.mongo["availability"].find(
                    {"player_id": user.id, "status": {"$in": ["available", "tentative"]}, "end_at": {"$gt": now}}
                )
            ]
            rows = [
                m for m in rows if merged_coverage(slots, ensure_utc(m["start_at"]), ensure_utc(m["end_at"])) >= 0.999
            ]

        # Remove matches where the user is already seated or has an active request/invite, but
        # keep the status so the UI can show "Requested".
        mids = [m["_id"] for m in rows]
        my_inv = {
            i["match_id"]: i["invitation_status"]
            async for i in self.c.mongo["invitations"].find(
                {"match_id": {"$in": mids}, "player_id": user.id, "is_active": True}
            )
        }
        seated = {
            r["match_id"]
            async for r in self.c.mongo["match_rosters"].find(
                {"match_id": {"$in": mids}, "player_id": user.id, "is_active": True}
            )
        }
        role_counts: dict[ObjectId, dict[str, int]] = {}
        async for r in await self.c.mongo["match_rosters"].aggregate(
            [
                {"$match": {"match_id": {"$in": mids}, "is_active": True}},
                {"$group": {"_id": {"m": "$match_id", "r": "$assigned_role"}, "n": {"$sum": 1}}},
            ]
        ):
            role_counts.setdefault(r["_id"]["m"], {})[r["_id"].get("r") or ""] = r["n"]

        results: list[tuple[dict[str, Any], dict[str, int]]] = []
        for m in rows:
            if m["_id"] in seated:
                continue
            required = m.get("required_roles") or {}
            counts = role_counts.get(m["_id"], {})
            needed = {k: max(0, int(required.get(k, 0)) - counts.get(k, 0)) for k in ROLES}
            if req.role and sum(required.values()) > 0 and needed.get(req.role.value, 0) == 0:
                continue
            results.append((m, needed))
        # Rank: proximity first, then soonest.
        results.sort(key=lambda x: (round(x[0]["distance_m"] / 500), ensure_utc(x[0]["start_at"])))
        total = len(results)
        page = results[(req.page - 1) * req.page_size : req.page * req.page_size]
        team_ids = list({m["team_id"] for m, _ in page})
        teams = {t["_id"]: t async for t in self.c.mongo["teams"].find({"_id": {"$in": team_ids}})}
        cap_ids = list({m["captain_id"] for m, _ in page})
        caps = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": cap_ids}})}
        cap_profiles = {
            p["user_id"]: p async for p in self.c.mongo["captain_profiles"].find({"user_id": {"$in": cap_ids}})
        }
        data = []
        for m, needed in page:
            t = teams.get(m["team_id"], {})
            venue = m.get("venue") or {}
            data.append(
                OpportunityOut(
                    match_id=str(m["_id"]),
                    match_code=m["match_code"],
                    title=m.get("title", "Match"),
                    start_at=m["start_at"],
                    end_at=m["end_at"],
                    timezone=m["timezone"],
                    format=m["format"],
                    category=m["category"],
                    area=venue.get("area"),
                    city=venue.get("city"),
                    approx_distance_km=approx_km(m["distance_m"]),
                    vacancies=m["squad_capacity"] - m.get("confirmed_count", 0),
                    squad_capacity=m["squad_capacity"],
                    roles_needed=needed,
                    per_head_fee_paise=m.get("per_head_fee_paise", 0),
                    default_contribution_type=m.get("default_contribution_type", "payee"),
                    team=TeamBrief(
                        id=str(m["team_id"]),
                        team_name=t.get("team_name", "Team"),
                        logo=t.get("logo"),
                        category=t.get("category", m["category"]),
                        area=t.get("area"),
                        average_rating=t.get("average_rating"),
                        captain=public_user(
                            caps.get(m["captain_id"], {"_id": m["captain_id"], "full_name": "Captain"})
                        ),
                        captain_rating=cap_profiles.get(m["captain_id"], {}).get("average_rating"),
                    ),
                    my_status=my_inv.get(m["_id"]),
                )
            )
        return TeamSearchOut(
            data=data,
            meta=PageMeta(
                page=req.page, page_size=req.page_size, total=total, has_next=req.page * req.page_size < total
            ),
        )
