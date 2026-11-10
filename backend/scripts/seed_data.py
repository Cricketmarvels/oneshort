"""Seed realistic Noida cricket data for DEVELOPMENT.

The script drives the real API in-process (dev OTP adapter), so every record passes the
same validation and business rules as production traffic. Refuses to run in production.

    uv run python -m scripts.seed_data --reset

Demo logins (OTP is returned by the dev adapter; the web app shows it automatically):
    Captain : +44 7700 900001  (Rahul Menon, captain of Sector 18 Kings)
    Player  : +44 7700 900002  (Arjun Rao, opening batsman)
    Admin   : +44 7700 900099  (Moderation admin)
All seeded numbers are in Ofcom's reserved drama range (see scripts/demo_numbers.py), so they can't reach a real
person. Type the full number, with +44, at login.
"""

import argparse
import asyncio
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from asgi_lifespan import LifespanManager
from bson import ObjectId

from app.core.config import get_settings
from app.core.container import build_container
from app.main import create_app
from scripts.demo_numbers import demo_mobile

API = "/api/v1"
IST_OFFSET = timedelta(hours=5, minutes=30)

AREAS: dict[str, tuple[float, float]] = {
    "Sector 18": (28.5708, 77.3261),
    "Sector 50": (28.5713, 77.3646),
    "Sector 58": (28.6100, 77.3600),
    "Sector 15": (28.5850, 77.3110),
    "Sector 44": (28.5530, 77.3370),
    "Sector 62": (28.6270, 77.3649),
    "Sector 63": (28.6250, 77.3800),
    "Noida Extension": (28.6060, 77.4250),
    "Sector 137": (28.5100, 77.4080),
    "Sector 128": (28.5240, 77.3550),
    "Sector 143": (28.5010, 77.4250),
    "Sector 76": (28.5660, 77.3850),
    "Greater Noida": (28.4744, 77.5040),
    "Indirapuram": (28.6460, 77.3695),
    "Mayur Vihar": (28.6080, 77.2930),
}
AREA_CITY = {"Greater Noida": "Greater Noida", "Indirapuram": "Ghaziabad", "Mayur Vihar": "Delhi"}

VENUES = [
    ("Noida Stadium Cricket Ground", "Stadium Rd, Sector 21A", "Sector 18", (28.5794, 77.3374)),
    ("Sector 50 Community Ground", "Block B, Sector 50", "Sector 50", (28.5720, 77.3620)),
    ("Sector 58 Turf Arena", "A Block, Sector 58", "Sector 58", (28.6095, 77.3590)),
    ("Sector 15 Practice Nets", "Near Metro Station, Sector 15", "Sector 15", (28.5845, 77.3115)),
    ("Sector 62 Box Cricket Arena", "Institutional Area, Sector 62", "Sector 62", (28.6280, 77.3670)),
    ("Noida Extension Sports Ground", "Gaur City 1, Noida Extension", "Noida Extension", (28.6065, 77.4240)),
    ("Sector 137 Cricket Ground", "Expressway Service Rd, Sector 137", "Sector 137", (28.5105, 77.4075)),
    ("Sector 76 Nets", "Main Rd, Sector 76", "Sector 76", (28.5655, 77.3860)),
]

FIRST = [
    "Arjun",
    "Rohan",
    "Vikram",
    "Karthik",
    "Siddharth",
    "Aditya",
    "Pranav",
    "Nikhil",
    "Rahul",
    "Varun",
    "Abhishek",
    "Harsha",
    "Manish",
    "Suresh",
    "Kiran",
    "Deepak",
    "Imran",
    "Faisal",
    "Joseph",
    "Ankit",
    "Gaurav",
    "Tejas",
    "Yash",
    "Shreyas",
    "Naveen",
    "Ravi",
    "Sameer",
    "Akash",
    "Mohit",
    "Pradeep",
]
LAST = [
    "Rao",
    "Sharma",
    "Iyer",
    "Menon",
    "Reddy",
    "Nair",
    "Gowda",
    "Kulkarni",
    "Shetty",
    "Khan",
    "Fernandes",
    "Patil",
    "Hegde",
    "Pillai",
    "Verma",
    "Bhat",
    "Joshi",
    "Singh",
    "D'Souza",
    "Kamath",
]
ROLES = ["batsman", "bowler", "wicketkeeper", "all_rounder"]
BOWLING = ["right_arm_fast", "right_arm_medium", "off_spin", "leg_spin", "left_arm_orthodox", "left_arm_medium"]


def ist(day_offset: int, hour: int, minute: int = 0) -> datetime:
    """A wall-clock time in Asia/Kolkata, `day_offset` days from today, as aware UTC."""
    today = (datetime.now(UTC) + IST_OFFSET).date()
    local = datetime(today.year, today.month, today.day, hour, minute) + timedelta(days=day_offset)
    return (local - IST_OFFSET).replace(tzinfo=UTC)


def next_weekday(weekday: int) -> int:
    today = (datetime.now(UTC) + IST_OFFSET).weekday()
    return (weekday - today) % 7 or 7


class Seeder:
    def __init__(self, client: httpx.AsyncClient, container: Any) -> None:
        self.http = client
        self.c = container
        self.tokens: dict[str, str] = {}
        self.ids: dict[str, str] = {}

    async def call(self, method: str, path: str, who: str | None = None, **kw: Any) -> Any:
        headers = {"Authorization": f"Bearer {self.tokens[who]}"} if who else {}
        r = await self.http.request(method, f"{API}{path}", headers=headers, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text}")
        return r.json().get("data") if r.content else None

    async def user(self, key: str, name: str, mobile: str, area: str, role: str, *, captain: bool = False) -> None:
        email = f"{name.lower().replace(' ', '.').replace(chr(39), '')}@example.in"
        reg = await self.call(
            "POST",
            "/auth/register",
            json={"full_name": name, "mobile_number": mobile, "email": email, "city": AREA_CITY.get(area, "Noida")},
        )
        tok = await self.call(
            "POST",
            "/auth/verify-otp",
            json={
                "mobile_number": mobile,
                "code": reg["otp"]["dev_otp"],
                "purpose": "register",
                "profile": {"full_name": name, "email": email, "city": AREA_CITY.get(area, "Noida")},
            },
        )
        self.tokens[key], self.ids[key] = tok["access_token"], tok["user"]["id"]
        cur = (await self.call("GET", "/agreements/current", key))["version"]
        await self.call(
            "POST",
            "/agreements/acceptance",
            key,
            json={"version": cur, "accepted": True, "age_confirmed": True, "privacy_acknowledged": True},
        )
        lat, lng = AREAS[area]
        jitter = lambda: random.uniform(-0.008, 0.008)  # noqa: E731 - homes spread around the area
        # No profile_image: the app shows branded initials until the player uploads a photo.
        secondary = random.sample([r for r in ROLES if r != role], k=random.choice([0, 1, 1, 2]))
        await self.call(
            "PUT",
            "/players/me",
            key,
            json={
                "primary_role": role,
                "secondary_roles": secondary,
                "batting_style": random.choice(["right_hand", "right_hand", "left_hand"]),
                "bowling_style": random.choice(BOWLING) if role in ("bowler", "all_rounder") else "none",
                "experience_years": random.randint(1, 15),
                "preferred_formats": random.sample(["T10", "T20", "ODI"], 2),
                "preferred_days": ["sat", "sun"],
                "preferred_timing": ["morning"],
                "bio": f"{role.replace('_', '-').title()} from {area}. Weekend cricket regular.",
                "home_location": {"lat": lat + jitter(), "lng": lng + jitter()},
                "locality": area,
            },
        )
        if captain:
            await self.call("PUT", "/captains/me", key, json={"bio": f"Running weekend games around {area}."})

    async def weekend_slots(self, key: str, area: str) -> None:
        lat, lng = AREAS[area]
        for wd in (5, 6):  # Sat, Sun
            day = next_weekday(wd)
            status = random.choices(["available", "tentative", "unavailable"], [0.75, 0.15, 0.10])[0]
            await self.call(
                "POST",
                "/availability",
                key,
                json={
                    "start_at": ist(day, 6).isoformat(),
                    "end_at": ist(day, 12).isoformat(),
                    "status": status,
                    "location": {"lat": lat, "lng": lng},
                    "location_label": area,
                    "max_travel_km": random.choice([5, 10, 15, 20]),
                    "repeat_weeks": 2,
                },
            )

    async def team(self, key: str, captain: str, name: str, area: str, category: str, desc: str) -> None:
        lat, lng = AREAS[area]
        t = await self.call(
            "POST",
            "/teams",
            captain,
            json={
                "team_name": name,
                "area": area,
                "city": AREA_CITY.get(area, "Noida"),
                "category": category,
                "description": desc,
                "location": {"lat": lat, "lng": lng},
            },
        )
        self.ids[key] = t["id"]

    async def add_members(self, team: str, captain: str, members: list[str]) -> None:
        for m in members:
            await self.call("POST", f"/teams/{self.ids[team]}/members", captain, json={"user_id": self.ids[m]})
            await self.call("POST", f"/teams/{self.ids[team]}/membership/accept", m)

    async def match(
        self,
        key: str,
        captain: str,
        team: str,
        venue_idx: int,
        start: datetime,
        hours: int,
        *,
        fmt: str = "T20",
        category: str = "friendly",
        capacity: int = 11,
        roles: dict[str, int] | None = None,
        expenses: int = 450000,
        title: str = "Weekend T20",
    ) -> None:
        name, address, area, (lat, lng) = VENUES[venue_idx]
        m = await self.call(
            "POST",
            "/matches",
            captain,
            json={
                "team_id": self.ids[team],
                "title": title,
                "description": "Tennis-ball friendly, bring whites if you can.",
                "venue": {"name": name, "address": address, "area": area, "city": "Noida"},
                "location": {"lat": lat, "lng": lng},
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(hours=hours)).isoformat(),
                "format": fmt,
                "category": category,
                "squad_capacity": capacity,
                "required_roles": roles or {"batsman": 4, "bowler": 3, "wicketkeeper": 1, "all_rounder": 2},
                "estimated_expenses_paise": expenses,
            },
        )
        self.ids[key] = m["id"]

    async def squad(
        self,
        match: str,
        captain: str,
        players: list[str],
        accept: bool = True,
        confirm: bool = True,
        non_payee: tuple[str, ...] = (),
    ) -> list[str]:
        res = await self.call(
            "POST",
            f"/matches/{self.ids[match]}/invitations",
            captain,
            json={
                "invites": [
                    {"player_id": self.ids[p], "contribution_type": "non_payee" if p in non_payee else "payee"}
                    for p in players
                ],
                "message": "Need you this weekend!",
            },
        )
        out = []
        for p, r in zip(players, res, strict=True):
            if not r["ok"]:
                print(f"   skip {p}: {r['error_code']}")
                continue
            out.append(p)
            if accept:
                await self.call("POST", f"/invitations/{r['invitation_id']}/accept", p)
                if confirm:
                    await self.call("POST", f"/invitations/{r['invitation_id']}/confirm", captain)
        return out


async def seed(reset: bool) -> None:
    settings = get_settings().model_copy(
        update={
            "scheduler_enabled": False,
            "rate_limit_auth_per_minute": 100_000,
            "rate_limit_default_per_minute": 100_000,
            "otp_resend_cooldown_seconds": 0,
            "otp_max_sends_per_hour": 10_000,
            "tester_signup_prefix": None,  # seeded demo accounts use the same fictional range; seeding isn't a tester sign-up
            "dev_otp_in_response": True,  # the seeder reads OTPs in-process; never exposed over HTTP
        }
    )
    if settings.app_env == "production" or settings.otp_provider != "console":
        raise SystemExit("Refusing to seed: requires a non-production environment with OTP_PROVIDER=console")
    container = build_container(settings)
    if reset:
        await container.mongo.client.drop_database(settings.mongodb_db)
    elif await container.mongo["users"].count_documents({}, limit=1):
        raise SystemExit("Database is not empty. Re-run with --reset to wipe and reseed.")
    random.seed(11)
    app = create_app(settings, container)
    async with (
        LifespanManager(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://seed") as client,
    ):
        s = Seeder(client, container)
        print("→ venues")
        await container.mongo["venues"].insert_many(
            [
                {
                    "name": n,
                    "address": a,
                    "area": ar,
                    "city": "Noida",
                    "location": {"type": "Point", "coordinates": [lng, lat]},
                }
                for n, a, ar, (lat, lng) in VENUES
            ]
        )

        print("→ users")
        await s.user("rahul", "Rahul Menon", demo_mobile(1), "Sector 18", "all_rounder", captain=True)
        await s.user("arjun", "Arjun Rao", demo_mobile(2), "Sector 50", "batsman")
        await s.user("priya_cap", "Imran Khan", demo_mobile(3), "Sector 62", "bowler", captain=True)
        await s.user("kiran_cap", "Kiran Tyagi", demo_mobile(4), "Sector 137", "wicketkeeper", captain=True)
        await s.user("admin", "Moderation Admin", demo_mobile(99), "Sector 58", "batsman")
        await container.mongo["users"].update_one({"_id": ObjectId(s.ids["admin"])}, {"$addToSet": {"roles": "admin"}})
        areas = [a for a in AREAS if a not in AREA_CITY]
        players: list[tuple[str, str]] = []
        used: set[str] = set()
        for i in range(32):
            while True:
                name = f"{random.choice(FIRST)} {random.choice(LAST)}"
                if name not in used and name not in ("Rahul Menon", "Arjun Rao", "Imran Khan", "Kiran Tyagi"):
                    used.add(name)
                    break
            area = areas[i % len(areas)]
            role = ROLES[i % 4] if i % 4 != 2 or i % 8 == 2 else "batsman"  # fewer keepers
            key = f"p{i:02d}"
            await s.user(key, name, demo_mobile(100 + i), area, role)
            players.append((key, area))
        print("→ availability")
        for key, area in [("arjun", "Sector 50"), *players]:
            await s.weekend_slots(key, area)

        print("→ teams")
        await s.team(
            "kings",
            "rahul",
            "Sector 18 Kings",
            "Sector 18",
            "friendly",
            "Sunday-morning T20 side. Friendly but competitive. All levels welcome.",
        )
        await s.team(
            "techxi",
            "priya_cap",
            "Sector 62 Tech XI",
            "Sector 62",
            "corporate",
            "Corporate league team of engineers from the Sector 62 IT parks. Plays the Tech Premier League.",
        )
        await s.team(
            "strikers",
            "kiran_cap",
            "Expressway Strikers",
            "Sector 137",
            "tournament",
            "Tournament side playing leather-ball T20 tournaments along the Noida Expressway.",
        )
        south = [k for k, a in players if a in ("Sector 18", "Sector 50", "Sector 44", "Sector 15", "Sector 76")]
        east = [k for k, a in players if a in ("Sector 62", "Sector 63", "Sector 76", "Sector 58")]
        north = [k for k, a in players if a in ("Sector 137", "Sector 128", "Sector 143")]
        await s.add_members("kings", "rahul", ["arjun", *south[:8]])
        await s.add_members("techxi", "priya_cap", east[:7])
        await s.add_members("strikers", "kiran_cap", north[:6])

        print("→ CricHeroes demo data (manual entry; no real CricHeroes team is linked)")
        kings_keys = ["rahul", "arjun", *south[:4]]
        name_of = {
            str(u["_id"]): u["full_name"]
            async for u in container.mongo["users"].find({"_id": {"$in": [ObjectId(s.ids[k]) for k in kings_keys]}})
        }
        roster = [name_of[s.ids[k]] for k in kings_keys]
        await s.call(
            "POST",
            f"/teams/{s.ids['kings']}/cricheroes/import",
            "rahul",
            json={
                "method": "manual",
                "data": {
                    "players": [
                        {"name": n, "sub_title": r}
                        for n, r in zip(
                            roster,
                            ["All-rounder", "Batsman", "Bowler", "Bowler", "Wicketkeeper", "Batsman"],
                            strict=False,
                        )
                    ]
                    + [{"name": "Vivek Tyagi", "sub_title": "Bowler"}],
                    "stats": [
                        {"label": "Matches", "value": "38"},
                        {"label": "Won", "value": "23"},
                        {"label": "Lost", "value": "14"},
                        {"label": "Win %", "value": "61%"},
                    ],
                },
            },
        )

        print("→ matches")
        sat, sun = next_weekday(5), next_weekday(6)
        # 1. Completed match last week with full squad, attendance, ratings and settlement
        await s.match(
            "past",
            "rahul",
            "kings",
            0,
            ist(sun, 7),
            3,
            title="Sunday Smash vs Sector 50 Hawks",
            capacity=6,
            roles={"batsman": 2, "bowler": 2, "wicketkeeper": 1, "all_rounder": 1},
            expenses=300000,
        )
        past_squad = await s.squad("past", "rahul", ["arjun", *south[:5]], non_payee=(south[4],))
        ps = [p for p in past_squad if p != "arjun"]
        await s.call(
            "POST",
            f"/matches/{s.ids['past']}/transition",
            "rahul",
            json={"to": "squad_confirmed", "allow_short_squad": True},
        )
        await s.call("POST", f"/matches/{s.ids['past']}/transition", "rahul", json={"to": "scheduled"})
        last_sun = ist(sun - 7, 7)
        await container.mongo["matches"].update_one(
            {"_id": ObjectId(s.ids["past"])}, {"$set": {"start_at": last_sun, "end_at": last_sun + timedelta(hours=3)}}
        )
        await s.call(
            "POST",
            f"/matches/{s.ids['past']}/complete",
            "rahul",
            json={
                "attendance": [
                    {"player_id": s.ids[p], "attendance": "late" if p == ps[1] else "present"} for p in past_squad
                ]
            },
        )
        for label, cat, amt in (
            ("Ground booking (3 hrs)", "ground", 240000),
            ("Tennis balls x6", "balls", 36000),
            ("Water & energy drinks", "refreshments", 24000),
        ):
            await s.call(
                "POST",
                f"/matches/{s.ids['past']}/expenses",
                "rahul",
                json={"label": label, "category": cat, "amount_paise": amt},
            )
        draft = await s.call(
            "POST",
            f"/matches/{s.ids['past']}/settlements",
            "rahul",
            json={"payment_instructions": "UPI: rahul.menon@okhdfc · or cash at next match"},
        )
        st = await s.call("POST", f"/settlements/{draft['id']}/publish", "rahul")
        await s.call(
            "POST",
            f"/settlements/{st['id']}/payments/{s.ids[ps[0]]}/mark-paid",
            "rahul",
            json={"method": "gpay", "remarks": "GPay received Sunday evening"},
        )
        await s.call(
            "POST",
            f"/settlements/{st['id']}/payments/{s.ids[ps[1]]}/mark-paid",
            "rahul",
            json={"method": "cash", "remarks": "Cash at ground"},
        )
        await s.call(
            "POST",
            f"/settlements/{st['id']}/payments/{s.ids[ps[2]]}/dispute",
            ps[2],
            json={"reason": "I paid ₹600 in cash to Arjun before the match"},
        )
        for p in past_squad:
            await s.call(
                "POST",
                f"/matches/{s.ids['past']}/ratings",
                p,
                json={
                    "reviewed_user_id": s.ids["rahul"],
                    "comment": random.choice(
                        [
                            "Everyone got a bat and a bowl. Well run.",
                            "Great communication on WhatsApp.",
                            "Started on time, fair rotation.",
                            None,
                        ]
                    ),
                    "scores": {
                        "behaviour": 5,
                        "fair_opportunities": random.randint(4, 5),
                        "team_management": 4,
                        "communication": random.randint(4, 5),
                        "punctuality": 5,
                        "overall": random.randint(4, 5),
                    },
                },
            )
            await s.call(
                "POST",
                f"/matches/{s.ids['past']}/ratings",
                "rahul",
                json={
                    "reviewed_user_id": s.ids[p],
                    "scores": {
                        "punctuality": 3 if p == ps[1] else 5,
                        "behaviour": 5,
                        "sportsmanship": random.randint(4, 5),
                        "participation": 5,
                        "overall": random.randint(3, 5),
                    },
                },
            )

        # 2. Upcoming: Kings recruiting for Sunday (needs a keeper + bowlers)
        await s.match("sun_kings", "rahul", "kings", 0, ist(sun, 7), 3, title="Sunday Morning T20")
        await s.squad("sun_kings", "rahul", ["arjun", *south[:3]])
        await s.squad("sun_kings", "rahul", south[3:6], confirm=False)
        # 3. Tech XI corporate match Saturday (open for join requests)
        await s.match(
            "sat_tech",
            "priya_cap",
            "techxi",
            4,
            ist(sat, 7),
            4,
            fmt="T20",
            category="corporate",
            title="Tech Premier League: Round 4",
            expenses=800000,
            capacity=12,
            roles={"batsman": 4, "bowler": 4, "wicketkeeper": 1, "all_rounder": 3},
        )
        await s.squad("sat_tech", "priya_cap", east[:5])
        # 4. Expressway tournament Sunday
        await s.match(
            "sun_strikers",
            "kiran_cap",
            "strikers",
            6,
            ist(sun, 6),
            5,
            fmt="ODI",
            category="tournament",
            title="Noida Expressway Cup: Quarter Final",
            expenses=1200000,
            capacity=13,
        )
        await s.squad("sun_strikers", "kiran_cap", north[:4])
        # 5. Practice session next Saturday (pending invitation for Arjun)
        await s.match(
            "practice",
            "rahul",
            "kings",
            7,
            ist(sat + 7, 7),
            2,
            fmt="OTHER",
            category="practice",
            title="Nets & fielding drills",
            expenses=120000,
            capacity=8,
            roles={"batsman": 3, "bowler": 3, "wicketkeeper": 1, "all_rounder": 1},
        )
        await s.squad("practice", "rahul", ["arjun"], accept=False)
        # Arjun requests to join the Tech XI match → pending join request for Imran
        try:
            await s.call(
                "POST",
                f"/matches/{s.ids['sat_tech']}/join-requests",
                "arjun",
                json={"proposed_role": "batsman", "message": "Opening bat, can keep if needed."},
            )
        except RuntimeError as exc:
            print("   join request skipped:", exc)

        await competition_demo(s, container, used, south, east, north)

        print("→ a sample report for the moderation queue")
        await s.call(
            "POST",
            "/reports",
            "arjun",
            json={
                "target_user_id": s.ids[east[0]],
                "category": "unsportsmanlike",
                "description": "Argued with the umpire for several overs and refused to leave the crease after being given out.",
            },
        )

    await container.mongo.close()
    print("\n✓ Seed complete.")
    print(f"  Captain login : {demo_mobile(1)} (Rahul Menon)")
    print(f"  Player login  : {demo_mobile(2)} (Arjun Rao)")
    print(f"  Admin login   : {demo_mobile(99)}")
    print("  OTP codes are shown by the dev adapter (OTP_PROVIDER=console).")


async def competition_demo(
    s: "Seeder", container: Any, used: set[str], south: list[str], east: list[str], north: list[str]
) -> None:
    """Three more NCR teams, a DEMO season of verified fixtures, live challenges and communities."""
    from scripts.demo_season import play_season

    print("→ NCR teams (Greater Noida, Ghaziabad, Delhi)")
    extra: dict[str, list[str]] = {}
    n = 0
    for key, cap_name, area, team_name, desc in (
        (
            "gnoida",
            "Saurabh Bhati",
            "Greater Noida",
            "Greater Noida Warriors",
            "Weekend side from Pari Chowk. Loves a T10 slog.",
        ),
        (
            "royals",
            "Deepak Chaudhary",
            "Indirapuram",
            "Indirapuram Royals",
            "Ghaziabad's Sunday regulars. Leather and tennis ball.",
        ),
        (
            "mavs",
            "Ankit Bhalla",
            "Mayur Vihar",
            "Mayur Vihar Mavericks",
            "East Delhi club side, playing across the Yamuna.",
        ),
    ):
        cap = f"{key}_cap"
        await s.user(cap, cap_name, demo_mobile(200 + n), area, "all_rounder", captain=True)
        n += 1
        await s.team(key, cap, team_name, area, "friendly", desc)
        members = []
        for i in range(7):
            while True:
                name = f"{random.choice(FIRST)} {random.choice(LAST)}"
                if name not in used:
                    used.add(name)
                    break
            mk = f"{key}_{i}"
            await s.user(mk, name, demo_mobile(200 + n), area, ROLES[i % 4] if i % 4 != 2 else "batsman")
            n += 1
            members.append(mk)
        await s.add_members(key, cap, members)
        extra[key] = [cap, *members]

    teams = {
        "kings": ("rahul", ["rahul", "arjun", *south[:8]]),
        "techxi": ("priya_cap", ["priya_cap", *east[:7]]),
        "strikers": ("kiran_cap", ["kiran_cap", *north[:6]]),
        **{k: (v[0], v) for k, v in extra.items()},
    }
    print("→ DEMO season: double round-robin, 30 verified fixtures (labelled as demo data in the app)")
    keys = ["kings", "techxi", "strikers", "gnoida", "royals", "mavs"]
    pairs = [(a, b) for i, a in enumerate(keys) for b in keys[i + 1 :]]
    random.Random(5).shuffle(pairs)
    season = [*pairs, *[(b, a) for a, b in pairs]]
    await play_season(s, container, teams, [(h, a, 90 - 3 * i) for i, (h, a) in enumerate(season)])

    print("→ live challenges for Sector 18 Kings")

    def prop(days: int, hour: int, fmt: str, venue: int) -> dict[str, Any]:
        name, _addr, area, _ = VENUES[venue]
        return {
            "start_at": ist(days, hour).isoformat(),
            "format": fmt,
            "venue": {"name": name, "area": area, "city": "Noida"},
            "conditions": "Tennis ball · 50/50 ground fee · neutral umpire",
        }

    async def demo_flag(cid: str) -> None:
        await container.mongo["team_challenges"].update_one({"_id": ObjectId(cid)}, {"$set": {"is_demo": True}})

    ch = await s.call(
        "POST",
        "/challenges",
        "priya_cap",
        json={
            "from_team_id": s.ids["techxi"],
            "to_team_id": s.ids["kings"],
            "proposal": prop(6, 7, "T20", 4),
            "message": "Rematch? We owe you one.",
        },
    )
    await demo_flag(ch["id"])
    ch = await s.call(
        "POST",
        "/challenges",
        "rahul",
        json={"from_team_id": s.ids["kings"], "to_team_id": s.ids["strikers"], "proposal": prop(13, 7, "T20", 0)},
    )
    await demo_flag(ch["id"])
    await s.call(
        "POST",
        f"/challenges/{ch['id']}/counter-propose",
        "kiran_cap",
        json={"proposal": prop(14, 16, "T15", 6), "message": "Saturday is booked. Sunday evening at our ground?"},
    )
    ch = await s.call(
        "POST",
        "/challenges",
        "gnoida_cap",
        json={"from_team_id": s.ids["gnoida"], "to_team_id": s.ids["kings"], "proposal": prop(3, 8, "T10", 0)},
    )
    await demo_flag(ch["id"])
    await s.call("POST", f"/challenges/{ch['id']}/accept", "rahul")
    await s.call("POST", f"/challenges/{ch['id']}/confirm", "gnoida_cap")
    # A played match whose result Rahul still has to verify
    ch = await s.call(
        "POST",
        "/challenges",
        "mavs_cap",
        json={"from_team_id": s.ids["mavs"], "to_team_id": s.ids["kings"], "proposal": prop(40, 7, "T10", 1)},
    )
    await demo_flag(ch["id"])
    await s.call("POST", f"/challenges/{ch['id']}/accept", "rahul")
    ch = await s.call("POST", f"/challenges/{ch['id']}/confirm", "mavs_cap")
    played = datetime.now(UTC) - timedelta(days=1, hours=6)
    await container.mongo["fixtures"].update_one(
        {"_id": ObjectId(ch["fixture_id"])}, {"$set": {"start_at": played, "is_demo": True}}
    )
    await container.mongo["team_challenges"].update_one(
        {"_id": ObjectId(ch["id"])}, {"$set": {"proposal.start_at": played, "history.$[].proposal.start_at": played}}
    )
    from scripts.demo_season import scorecard as make_card

    rng = random.Random(7)
    xi = lambda keys: [{"id": s.ids[k], "skill": 1.0, "role": "all_rounder"} for k in keys[:8]]  # noqa: E731
    mavs_ids = {s.ids[k] for k in teams["mavs"][1]}
    card = make_card(
        (s.ids["mavs"], xi(teams["mavs"][1])),
        (s.ids["kings"], [p for p in xi(teams["kings"][1]) if p["id"] not in mavs_ids]),
        10,
        rng,
    )
    await s.call("POST", f"/fixtures/{ch['fixture_id']}/result", "mavs_cap", json=card)

    print("→ communities")
    noida = await s.call(
        "POST",
        "/communities",
        "rahul",
        json={
            "name": "Noida Cricket Community",
            "kind": "city",
            "city": "Noida",
            "area": "Noida",
            "location": {"lat": 28.5355, "lng": 77.3910},
            "description": "Everyone who plays cricket in Noida: find games, fill gaps in your XI and talk cricket.",
            "guidelines": "Be on time, respect umpires and grounds, settle money promptly, no abuse or spam.",
        },
    )
    sec137 = await s.call(
        "POST",
        "/communities",
        "kiran_cap",
        json={
            "name": "Sector 137 Cricket",
            "kind": "sector",
            "visibility": "private",
            "city": "Noida",
            "area": "Sector 137",
            "location": {"lat": AREAS["Sector 137"][0], "lng": AREAS["Sector 137"][1]},
            "description": "Residents' cricket for the Sector 137 societies. Early-morning games on the Expressway ground.",
        },
    )
    gn = await s.call(
        "POST",
        "/communities",
        "gnoida_cap",
        json={
            "name": "Greater Noida Weekend Cricket",
            "kind": "weekend",
            "city": "Greater Noida",
            "area": "Pari Chowk",
            "location": {"lat": AREAS["Greater Noida"][0], "lng": AREAS["Greater Noida"][1]},
            "description": "Saturday and Sunday games across Greater Noida. Turn up, get picked, play.",
        },
    )
    ncr = await s.call(
        "POST",
        "/communities",
        "priya_cap",
        json={
            "name": "NCR Corporate Cricket",
            "kind": "corporate",
            "city": "Noida",
            "area": "Sector 62",
            "location": {"lat": AREAS["Sector 62"][0], "lng": AREAS["Sector 62"][1]},
            "description": "Office teams across Noida, Gurugram and Delhi. Inter-company fixtures and leagues.",
        },
    )
    for key in dict.fromkeys(
        ["arjun", "priya_cap", "kiran_cap", "gnoida_cap", *south[:6], *east[:4], *extra["gnoida"][1:3]]
    ):
        await s.call("POST", f"/communities/{noida['id']}/join", key, json={"accept_guidelines": True})
    for key in dict.fromkeys([*north[:4], "rahul"]):
        await s.call("POST", f"/communities/{sec137['id']}/join", key, json={"accept_guidelines": True})
    for key in north[:3]:
        await s.call("POST", f"/communities/{sec137['id']}/members/{s.ids[key]}/approve", "kiran_cap")
    for key in dict.fromkeys([*extra["gnoida"][1:], "rahul", *extra["royals"][:3]]):
        await s.call("POST", f"/communities/{gn['id']}/join", key, json={"accept_guidelines": True})
    for key in dict.fromkeys([*east[:5], "rahul", "mavs_cap"]):
        await s.call("POST", f"/communities/{ncr['id']}/join", key, json={"accept_guidelines": True})
    for team, cap, com in (
        ("kings", "rahul", noida),
        ("techxi", "priya_cap", noida),
        ("techxi", "priya_cap", ncr),
        ("gnoida", "gnoida_cap", gn),
        ("strikers", "kiran_cap", sec137),
    ):
        await s.call("POST", f"/communities/{com['id']}/teams", cap, json={"team_id": s.ids[team]})
    await s.call(
        "PUT", f"/communities/{noida['id']}/members/{s.ids['arjun']}/role", "rahul", json={"role": "moderator"}
    )
    await s.call(
        "POST",
        f"/communities/{noida['id']}/posts",
        "rahul",
        json={
            "type": "announcement",
            "body": "Noida Stadium nets are free this Saturday 6–9am. Bring your own balls; tag your XI below.",
        },
    )
    await s.call(
        "POST",
        f"/communities/{noida['id']}/posts",
        "arjun",
        json={
            "type": "poll",
            "body": "Monsoon league format?",
            "poll_options": [{"text": "T10 evenings"}, {"text": "T20 Sunday mornings"}, {"text": "T15 Saturdays"}],
        },
    )
    await s.call(
        "POST",
        f"/communities/{noida['id']}/posts",
        south[0],
        json={"body": "Need one keeper for Sunday 7am at Sector 50 ground. DM if free!"},
    )
    await s.call(
        "POST",
        f"/communities/{noida['id']}/posts",
        "priya_cap",
        json={
            "type": "match",
            "body": "Tech XI looking for a T20 opponent next weekend, rating 1450–1600. Send a challenge.",
        },
    )
    await s.call(
        "POST",
        f"/communities/{gn['id']}/posts",
        "gnoida_cap",
        json={"type": "announcement", "body": "Pari Chowk ground re-turfed. Games resume Sunday."},
    )
    await s.call(
        "POST",
        f"/communities/{ncr['id']}/posts",
        "priya_cap",
        json={
            "type": "tournament",
            "body": "NCR Corporate Cup registrations open: 12 teams, T15, four weekends in November.",
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop the database before seeding")
    asyncio.run(seed(parser.parse_args().reset))


if __name__ == "__main__":
    main()
