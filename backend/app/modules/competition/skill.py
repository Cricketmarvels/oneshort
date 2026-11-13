"""Applies verified fixture results to team and player skill ratings.

Only results with status ``confirmed`` (verified by the opposing captain, or by an
administrator resolving a dispute) are ever applied. Disputed, submitted or voided
results never touch ratings. Applying is idempotent (``ratings_applied`` flag, set in the
same transaction), and ``rebuild_all`` replays every confirmed fixture in chronological
order — used after an administrator voids a previously confirmed result.
"""

from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.common.enums import NotificationType, ResultStatus, ResultType
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.modules.rating_engine.composite import (
    DISCIPLINES,
    all_rounder_rating,
    composite,
    consistency,
    weights_for,
)
from app.modules.rating_engine.config import (
    ALL_ROUNDER_MIN_EACH,
    CONSERVATIVE_K,
    CONSISTENCY_WINDOW,
    INACTIVITY_PERIOD_DAYS,
    OPPOSITION_RD,
    OPPOSITION_WEIGHT,
    STRONGER_SIDE_MARGIN,
)
from app.modules.rating_engine.explain import match_reasons
from app.modules.rating_engine.glicko2 import Glicko, inflate, update
from app.modules.rating_engine.performance import (
    BattingLine,
    BowlingLine,
    FieldingLine,
    batting_score,
    bowling_score,
    fielding_score,
    impact_score,
)

TREND_LEN = 12


def _g(d: dict[str, Any] | None) -> Glicko:
    return Glicko(d["r"], d["rd"], d["vol"]) if d else Glicko()


def _gd(g: Glicko, n: int) -> dict[str, Any]:
    return {"r": round(g.rating, 2), "rd": round(g.rd, 2), "vol": g.vol, "n": n}


def _periods(last: datetime | None, now: datetime) -> float:
    if not last:
        return 0.0
    return max(0.0, (ensure_utc(now) - ensure_utc(last)).days / INACTIVITY_PERIOD_DAYS)


def _composite_doc(disc: dict[str, Any], role: str | None, matches: int) -> dict[str, Any]:
    ratings = {d: _g(disc.get(d)) for d in DISCIPLINES}
    counts = {d: (disc.get(d) or {}).get("n", 0) for d in DISCIPLINES}
    c = composite(ratings, counts, role, matches)
    return {
        "rating": c.rating,
        "rd": c.rd,
        "confidence": c.confidence,
        "provisional": c.provisional,
        "conservative": round(c.conservative, 1),
    }


def sort_scores(doc: dict[str, Any]) -> dict[str, float | None]:
    """Conservative (rating − K·RD) values that leaderboards sort by."""
    disc = doc.get("disc") or {}

    def cons(d: str) -> float | None:
        x = disc.get(d)
        return round(x["r"] - CONSERVATIVE_K * x["rd"], 1) if x and x.get("n") else None

    bat, bowl = disc.get("bat"), disc.get("bowl")
    ar = None
    if bat and bowl and bat.get("n", 0) >= ALL_ROUNDER_MIN_EACH and bowl.get("n", 0) >= ALL_ROUNDER_MIN_EACH:
        ar = round(
            all_rounder_rating(
                Glicko(bat["r"] - CONSERVATIVE_K * bat["rd"]), Glicko(bowl["r"] - CONSERVATIVE_K * bowl["rd"])
            ),
            1,
        )
    return {
        "overall": doc["overall"]["conservative"] if doc.get("matches") else None,
        "bat": cons("bat"),
        "bowl": cons("bowl"),
        "field": cons("field"),
        "all_rounder": ar,
        "consistency": doc.get("consistency"),
    }


def _snapshot(doc: dict[str, Any]) -> dict[str, float]:
    disc = doc.get("disc") or {}
    return {
        "overall": doc["overall"]["rating"],
        **{d: (disc.get(d) or {}).get("r", 1500.0) for d in DISCIPLINES},
    }


def _result_for(team_id: ObjectId, fx: dict[str, Any]) -> str:
    r = fx["result"]
    if r["result_type"] == ResultType.TIED:
        return "tied"
    if r["result_type"] == ResultType.NO_RESULT:
        return "no_result"
    return "won" if r["winner_team_id"] == team_id else "lost"


class SkillRatingService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.players = c.mongo["player_ratings"]
        self.teams = c.mongo["team_ratings"]

    async def apply_fixture(
        self, fx: dict[str, Any], session: AsyncClientSession | None = None, notify: bool = True
    ) -> None:
        res = fx.get("result") or {}
        if res.get("status") != ResultStatus.CONFIRMED or fx.get("ratings_applied"):
            return
        flagged = await self.c.mongo["fixtures"].update_one(
            {"_id": fx["_id"], "ratings_applied": False}, {"$set": {"ratings_applied": True}}, session=session
        )
        if flagged.modified_count == 0:
            return  # another request applied it
        if res["result_type"] == ResultType.NO_RESULT:
            return
        at = fx["start_at"]
        home, away = fx["home_team_id"], fx["away_team_id"]
        names = {
            t["_id"]: t["team_name"]
            async for t in self.c.mongo["teams"].find({"_id": {"$in": [home, away]}}, {"team_name": 1}, session=session)
        }

        # ---- teams (pre-match ratings are the opposition strength for players too)
        tdocs = {tid: await self.teams.find_one({"team_id": tid}, session=session) for tid in (home, away)}
        pre = {
            tid: inflate(_g((d or {}).get("glicko")), _periods((d or {}).get("last_match_at"), at))
            for tid, d in tdocs.items()
        }
        for tid, opp in ((home, away), (away, home)):
            outcome = _result_for(tid, fx)
            score = {"won": 1.0, "lost": 0.0, "tied": 0.5}[outcome]
            new = update(pre[tid], [(pre[opp], score)])
            d = tdocs[tid] or {}
            letter = {"won": "W", "lost": "L", "tied": "T"}[outcome]
            streak = d.get("streak") or {}
            streak = {"kind": letter, "count": streak.get("count", 0) + 1 if streak.get("kind") == letter else 1}
            await self.teams.update_one(
                {"team_id": tid},
                {
                    "$set": {
                        "glicko": _gd(new, d.get("played", 0) + 1),
                        "rating": round(new.rating, 1),
                        "rd": round(new.rd, 1),
                        "conservative": round(new.rating - CONSERVATIVE_K * new.rd, 1),
                        "previous_conservative": d.get("conservative"),
                        "streak": streak,
                        "last_match_at": at,
                        "updated_at": utcnow(),
                    },
                    "$inc": {"played": 1, outcome: 1},
                    "$push": {
                        "form": {"$each": [letter], "$slice": -10},
                        "trend": {"$each": [round(new.rating, 1)], "$slice": -TREND_LEN},
                    },
                    "$max": {"has_demo": bool(fx.get("is_demo"))},
                },
                upsert=True,
                session=session,
            )
            await self.c.mongo["team_rating_history"].insert_one(
                {
                    "team_id": tid,
                    "fixture_id": fx["_id"],
                    "opponent_team_id": opp,
                    "at": at,
                    "result": outcome,
                    "before": round(pre[tid].rating, 1),
                    "after": round(new.rating, 1),
                    "is_demo": bool(fx.get("is_demo")),
                },
                session=session,
            )

        # ---- players
        innings = {i["batting_team_id"]: i for i in res.get("innings") or []}
        uids = [p["user_id"] for p in res.get("players") or []]
        roles = {
            p["user_id"]: p.get("primary_role")
            async for p in self.c.mongo["player_profiles"].find(
                {"user_id": {"$in": uids}}, {"user_id": 1, "primary_role": 1}, session=session
            )
        }
        fmt = fx["format"]
        overs = float(fx["overs"])
        notices: list[tuple[ObjectId, float]] = []
        for line in res.get("players") or []:
            uid, tid = line["user_id"], line["team_id"]
            opp_id = away if tid == home else home
            gap = pre[opp_id].rating - pre[tid].rating
            opp = Glicko(1500.0 + OPPOSITION_WEIGHT * gap, OPPOSITION_RD)
            outcome = _result_for(tid, fx)
            role = roles.get(uid)
            team_total = (innings.get(tid) or {}).get("runs", 0)
            bat = line.get("batting")
            bowl = line.get("bowling")
            field = line.get("fielding") or {"catches": 0, "run_outs": 0, "stumpings": 0}
            perf: dict[str, float | None] = {
                "bat": batting_score(BattingLine(**bat), team_total, overs) if bat else None,
                "bowl": bowling_score(BowlingLine(**bowl), overs) if bowl else None,
                "field": fielding_score(FieldingLine(**field)),
            }
            impact = impact_score({k: perf[k] for k in ("bat", "bowl", "field")}, weights_for(role), outcome)
            perf["impact"] = impact

            doc = await self.players.find_one({"user_id": uid}, session=session) or {
                "user_id": uid,
                "disc": {},
                "formats": {},
                "matches": 0,
                "impacts": [],
                "trend": [],
                "overall": {
                    "rating": 1500.0,
                    "rd": 350.0,
                    "confidence": 0.0,
                    "provisional": True,
                    "conservative": 800.0,
                },
            }
            before = _snapshot(doc)
            periods = _periods(doc.get("last_match_at"), at)
            fdoc = (doc.get("formats") or {}).get(fmt) or {"disc": {}, "matches": 0}
            new_disc = dict(doc.get("disc") or {})
            new_fdisc = dict(fdoc.get("disc") or {})
            for key, p_score in perf.items():
                if p_score is None:
                    continue
                for store in (new_disc, new_fdisc):
                    cur = store.get(key)
                    g = inflate(_g(cur), periods)
                    store[key] = _gd(update(g, [(opp, p_score)]), (cur or {}).get("n", 0) + 1)
            matches = doc.get("matches", 0) + 1
            impacts = ([*doc.get("impacts", []), round(impact, 4)])[-CONSISTENCY_WINDOW:]
            overall = _composite_doc(new_disc, role, matches)
            f_matches = fdoc.get("matches", 0) + 1
            formats = dict(doc.get("formats") or {})
            formats[fmt] = {
                "disc": new_fdisc,
                "matches": f_matches,
                "overall": _composite_doc(new_fdisc, role, f_matches),
            }
            new_doc = {
                **doc,
                "disc": new_disc,
                "formats": formats,
                "matches": matches,
                "impacts": impacts,
                "consistency": consistency(impacts),
                "overall": overall,
                "role": role,
                "trend": [*doc.get("trend", []), overall["rating"]][-TREND_LEN:],
                "last_match_at": at,
                "has_demo": bool(doc.get("has_demo")) or bool(fx.get("is_demo")),
                "updated_at": utcnow(),
            }
            new_doc["previous_scores"] = doc.get("scores")
            new_doc["scores"] = sort_scores(new_doc)
            for f, fd in formats.items():
                fd["score"] = fd["overall"]["conservative"]
                if f == fmt:
                    fd["previous_score"] = ((doc.get("formats") or {}).get(fmt) or {}).get("score")
            new_doc.pop("_id", None)
            await self.players.update_one({"user_id": uid}, {"$set": new_doc}, upsert=True, session=session)

            after = _snapshot(new_doc)
            deltas = {d: after[d] - before[d] for d in DISCIPLINES if perf.get(d) is not None}
            reasons = match_reasons(
                deltas,
                {"bat": bat, "bowl": bowl, "field": field},
                names.get(opp_id, "the opposition"),
                gap > STRONGER_SIDE_MARGIN,
                outcome,
            )
            await self.c.mongo["player_rating_history"].insert_one(
                {
                    "user_id": uid,
                    "fixture_id": fx["_id"],
                    "team_id": tid,
                    "opponent_team_id": opp_id,
                    "at": at,
                    "format": fmt,
                    "result": outcome,
                    "before": {k: round(v, 1) for k, v in before.items()},
                    "after": {k: round(v, 1) for k, v in after.items()},
                    "performance": {k: (round(v, 3) if v is not None else None) for k, v in perf.items()},
                    "lines": {"bat": bat, "bowl": bowl, "field": field},
                    "reasons": reasons,
                    "is_demo": bool(fx.get("is_demo")),
                },
                session=session,
            )
            notices.append((uid, after["overall"] - before["overall"]))

        await self.c.audit.log(
            actor_id=None,
            action="ratings.applied",
            entity_type="fixture",
            entity_id=fx["_id"],
            new_value={"players": len(notices)},
            session=session,
        )
        if notify and session is None:
            await self.notify_changes(fx, notices)

    async def notify_changes(self, fx: dict[str, Any], notices: list[tuple[ObjectId, float]] | None = None) -> None:
        if notices is None:
            notices = [
                (h["user_id"], h["after"]["overall"] - h["before"]["overall"])
                async for h in self.c.mongo["player_rating_history"].find({"fixture_id": fx["_id"]})
            ]
        for uid, delta in notices:
            sign = "+" if delta >= 0 else "−"
            await self.c.notifications.notify(
                [uid],
                NotificationType.RATING_UPDATED,
                f"Rating {sign}{abs(round(delta))}",
                "Your OneShort rating was updated from a verified match result. Tap to see why.",
                {"fixture_id": fx["_id"], "user_id": uid},
            )

    async def rebuild_all(self) -> int:
        """Recompute every rating from confirmed fixtures in chronological order."""
        for col in ("player_ratings", "player_rating_history", "team_ratings", "team_rating_history"):
            await self.c.mongo[col].delete_many({})
        await self.c.mongo["fixtures"].update_many({}, {"$set": {"ratings_applied": False}})
        n = 0
        async for fx in (
            self.c.mongo["fixtures"].find({"result.status": ResultStatus.CONFIRMED.value}).sort("start_at", 1)
        ):
            await self.apply_fixture(fx, notify=False)
            n += 1
        return n
