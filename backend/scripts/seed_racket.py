"""Demo data for Badminton & Pickleball (idempotent; safe to re-run).

Adds sample courts around Noida (every court is `is_demo: True` and shown as a "Sample listing"),
racket profiles for the existing demo users near their cricket home locations, and two play requests.
Run after scripts.seed_data:  uv run python -m scripts.seed_racket
"""

import asyncio
import random
from datetime import UTC, datetime, timedelta

from app.core.config import get_settings
from app.core.container import build_container

COURTS = [
    (
        "Smash Arena Badminton",
        "C-12, Sector 18 Market",
        "Sector 18",
        (28.5702, 77.3218),
        {"badminton": 6},
        True,
        ["Parking", "Changing rooms", "Racket hire"],
    ),
    (
        "Shuttle House",
        "Plot 4, Sector 50",
        "Sector 50",
        (28.5707, 77.3720),
        {"badminton": 4},
        True,
        ["Parking", "Coaching"],
    ),
    (
        "Noida Stadium Indoor Hall",
        "Noida Stadium, Sector 21A",
        "Sector 21A",
        (28.5803, 77.3372),
        {"badminton": 8, "pickleball": 2},
        True,
        ["Parking", "Cafe", "Lockers"],
    ),
    (
        "Dink & Drive Pickleball",
        "Sector 62 Institutional Area",
        "Sector 62",
        (28.6260, 77.3647),
        {"pickleball": 4},
        False,
        ["Floodlights", "Paddle hire"],
    ),
    (
        "Paddle Point",
        "Logix Mall Road, Sector 32",
        "Sector 32",
        (28.5747, 77.3560),
        {"pickleball": 3},
        False,
        ["Floodlights", "Parking"],
    ),
    (
        "Sector 137 Sports Club",
        "Near Sector 137 Metro",
        "Sector 137",
        (28.5104, 77.4072),
        {"badminton": 3, "pickleball": 2},
        True,
        ["Changing rooms", "Coaching"],
    ),
    (
        "Greater Noida Racket Centre",
        "Knowledge Park II",
        "Greater Noida",
        (28.4590, 77.4990),
        {"badminton": 5, "pickleball": 3},
        True,
        ["Parking", "Cafe"],
    ),
    (
        "Indirapuram Rally Courts",
        "Shakti Khand 2",
        "Indirapuram",
        (28.6420, 77.3700),
        {"badminton": 2, "pickleball": 2},
        False,
        ["Floodlights"],
    ),
]
LEVELS = ["beginner", "intermediate", "intermediate", "advanced", "professional"]
TIMES = ["morning", "afternoon", "evening", "night"]
AVAIL = ["today", "weekdays", "weekends"]
FORMATS = ["singles", "doubles", "mixed"]


async def seed() -> None:
    c = build_container(get_settings())
    m = c.mongo
    random.seed(7)
    now = datetime.now(UTC)
    for name, addr, area, (lat, lng), courts, indoor, amen in COURTS:
        await m["courts"].update_one(
            {"name": name},
            {
                "$set": {
                    "name": name,
                    "address": addr,
                    "area": area,
                    "city": "Noida"
                    if "Greater" not in area and area != "Indirapuram"
                    else ("Greater Noida" if "Greater" in area else "Ghaziabad"),
                    "sports": sorted(courts),
                    "courts": courts,
                    "indoor": indoor,
                    "amenities": amen,
                    "phone": None,
                    "is_demo": True,
                    "location": {"type": "Point", "coordinates": [lng, lat]},
                }
            },
            upsert=True,
        )
    print(f"courts: {await m['courts'].count_documents({})}")

    profiles = [
        p
        async for p in m["player_profiles"].find(
            {"home_location": {"$exists": True}}, {"user_id": 1, "home_location": 1, "locality": 1}
        )
    ]
    users = {u["_id"]: u async for u in m["users"].find({}, {"full_name": 1})}
    made = 0
    for i, p in enumerate(profiles):
        name = users.get(p["user_id"], {}).get("full_name", "")
        sports = (
            ["pickleball"]
            if name == "Rahul Menon"
            else ["badminton", "pickleball"]
            if i % 3 == 0
            else ["badminton"]
            if i % 3 == 1
            else ["pickleball"]
        )
        for sport in sports:
            lng, lat = p["home_location"]["coordinates"]
            jitter = [lng + random.uniform(-0.01, 0.01), lat + random.uniform(-0.01, 0.01)]
            res = await m["racket_profiles"].update_one(
                {"user_id": p["user_id"], "sport": sport},
                {
                    "$setOnInsert": {
                        "user_id": p["user_id"],
                        "sport": sport,
                        "level": random.choice(LEVELS),
                        "preferred_times": random.sample(TIMES, random.randint(1, 2)),
                        "availability": random.sample(AVAIL, random.randint(1, 2)),
                        "formats": random.sample(FORMATS, random.randint(1, 2)),
                        "gender": "undisclosed",
                        "locality": p.get("locality"),
                        "bio": None,
                        "discoverable": True,
                        "location": {"type": "Point", "coordinates": jitter},
                        "is_demo": True,
                        "created_at": now,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )
            made += int(res.upserted_id is not None)
    print(f"racket profiles created: {made}, total: {await m['racket_profiles'].count_documents({})}")

    rahul = next((uid for uid, u in users.items() if u.get("full_name") == "Rahul Menon"), None)
    arjun = next((uid for uid, u in users.items() if u.get("full_name") == "Arjun Rao"), None)
    if rahul and arjun:
        await m["racket_profiles"].update_one(
            {"user_id": arjun, "sport": "pickleball"},
            {
                "$setOnInsert": {
                    "user_id": arjun,
                    "sport": "pickleball",
                    "level": "intermediate",
                    "preferred_times": ["evening"],
                    "availability": ["weekends"],
                    "formats": ["doubles"],
                    "gender": "undisclosed",
                    "locality": "Sector 50",
                    "bio": None,
                    "discoverable": True,
                    "is_demo": True,
                    "location": {"type": "Point", "coordinates": [77.372, 28.571]},
                    "created_at": now,
                    "updated_at": now,
                }
            },
            upsert=True,
        )
        if not await m["play_requests"].find_one({"from_user_id": arjun, "to_user_id": rahul, "sport": "pickleball"}):
            await m["play_requests"].insert_one(
                {
                    "sport": "pickleball",
                    "from_user_id": arjun,
                    "to_user_id": rahul,
                    "status": "pending",
                    "message": "Doubles at Dink & Drive this Saturday evening?",
                    "proposed_at": now + timedelta(days=2),
                    "court_id": (await m["courts"].find_one({"name": "Dink & Drive Pickleball"}))["_id"],
                    "created_at": now,
                    "responded_at": None,
                }
            )
    print(f"play requests: {await m['play_requests'].count_documents({})}")


if __name__ == "__main__":
    asyncio.run(seed())
