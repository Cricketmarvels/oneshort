"""Index and collection-validator definitions. Applied idempotently at startup.

Each index is justified by a query pattern documented in docs/DATABASE_DESIGN.md.
"""

from typing import Any

from pymongo import ASCENDING, DESCENDING, GEOSPHERE, TEXT, IndexModel
from pymongo.errors import CollectionInvalid

from app.infrastructure.database.mongo import Mongo

_STR = {"$type": "string"}
_ACTIVE = {"is_active": True}

INDEXES: dict[str, list[IndexModel]] = {
    "users": [
        IndexModel(
            [("mobile_number", ASCENDING)],
            unique=True,
            partialFilterExpression={"mobile_number": _STR},
            name="uniq_mobile",
        ),
        IndexModel([("email", ASCENDING)], unique=True, partialFilterExpression={"email": _STR}, name="uniq_email"),
        # Lookups: the partial unique indexes above can't serve a plain equality match ({"mobile_number": x}),
        # because the planner can't prove x is a string. Without these, login/OTP/sign-up scan every user.
        IndexModel([("mobile_number", ASCENDING)], name="mobile_lookup"),
        IndexModel([("email", ASCENDING)], name="email_lookup"),
        IndexModel([("city", ASCENDING)]),  # home feed fallback when the user has no location
        IndexModel([("account_status", ASCENDING)]),
    ],
    "login_failures": [
        IndexModel([("email", ASCENDING)], unique=True),
        IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
    ],
    "otp_codes": [
        IndexModel([("mobile_number", ASCENDING), ("purpose", ASCENDING)]),
        IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
        # send logs feed the daily abuse budgets, so they live 24h (auth review H1)
        IndexModel(
            [("created_at", ASCENDING)],
            expireAfterSeconds=86400,
            name="otp_send_log_ttl_24h",
            partialFilterExpression={"kind": "send_log"},
        ),
        IndexModel([("kind", ASCENDING), ("created_at", ASCENDING)], name="otp_budget_counts"),
    ],
    "refresh_tokens": [
        IndexModel([("token_hash", ASCENDING)], unique=True),
        IndexModel([("family_id", ASCENDING)]),
        IndexModel([("user_id", ASCENDING)]),
        IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
    ],
    "devices": [
        IndexModel([("push_token", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING)]),
    ],
    "player_profiles": [
        IndexModel([("user_id", ASCENDING)], unique=True),
        IndexModel([("home_location", GEOSPHERE)]),
    ],
    "captain_profiles": [IndexModel([("user_id", ASCENDING)], unique=True)],
    "teams": [
        IndexModel([("captain_id", ASCENDING), ("team_status", ASCENDING)]),
        IndexModel([("admin_ids", ASCENDING)]),
        IndexModel([("city", ASCENDING), ("team_status", ASCENDING)]),
        IndexModel([("location", GEOSPHERE)]),
        IndexModel([("team_name", TEXT), ("area", TEXT)], name="team_text"),
    ],
    "cricheroes_teams": [IndexModel([("team_id", ASCENDING)], unique=True)],
    "player_ratings": [
        IndexModel([("user_id", ASCENDING)], unique=True),
        IndexModel([("scores.overall", DESCENDING)]),
        IndexModel([("matches", ASCENDING)]),
    ],
    "player_rating_history": [
        IndexModel([("user_id", ASCENDING), ("at", DESCENDING)]),
        IndexModel([("fixture_id", ASCENDING)]),
        IndexModel([("team_id", ASCENDING)]),
        IndexModel([("at", DESCENDING)]),
    ],
    "team_ratings": [IndexModel([("team_id", ASCENDING)], unique=True), IndexModel([("conservative", DESCENDING)])],
    "team_rating_history": [IndexModel([("team_id", ASCENDING), ("at", DESCENDING)])],
    "team_challenges": [
        IndexModel(
            [("slot_key", ASCENDING)],
            unique=True,
            partialFilterExpression={"slot_key": _STR},
            name="uniq_active_challenge_slot",
        ),
        IndexModel([("from_team_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)]),
        IndexModel([("to_team_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)]),
    ],
    "fixtures": [
        IndexModel([("home_team_id", ASCENDING), ("status", ASCENDING), ("start_at", ASCENDING)]),
        IndexModel([("away_team_id", ASCENDING), ("status", ASCENDING), ("start_at", ASCENDING)]),
        IndexModel([("result.status", ASCENDING), ("start_at", ASCENDING)]),
        IndexModel([("code", ASCENDING)], unique=True),
    ],
    "communities": [
        IndexModel([("slug", ASCENDING)], unique=True),
        IndexModel([("location", GEOSPHERE)]),
        IndexModel([("city", ASCENDING), ("member_count", DESCENDING)]),
    ],
    "community_members": [
        IndexModel([("community_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("community_id", ASCENDING), ("status", ASCENDING), ("role", ASCENDING)]),
    ],
    "community_teams": [IndexModel([("community_id", ASCENDING), ("team_id", ASCENDING)], unique=True)],
    "community_posts": [IndexModel([("community_id", ASCENDING), ("removed", ASCENDING), ("_id", DESCENDING)])],
    "community_poll_votes": [IndexModel([("post_id", ASCENDING), ("user_id", ASCENDING)], unique=True)],
    "community_post_reports": [IndexModel([("post_id", ASCENDING), ("user_id", ASCENDING)], unique=True)],
    "fee_sides": [IndexModel([("fixture_id", ASCENDING), ("team_id", ASCENDING)], unique=True)],
    "fee_squads": [
        IndexModel([("match_id", ASCENDING), ("player_id", ASCENDING)], unique=True),
        IndexModel([("player_id", ASCENDING), ("is_active", ASCENDING)]),
    ],
    "user_blocks": [IndexModel([("user_id", ASCENDING), ("blocked_id", ASCENDING)], unique=True)],
    "match_invite_links": [
        IndexModel([("code", ASCENDING)], unique=True),
        IndexModel([("match_id", ASCENDING), ("active", ASCENDING)]),
    ],
    "post_hides": [IndexModel([("user_id", ASCENDING), ("post_id", ASCENDING)], unique=True)],
    "team_members": [
        IndexModel([("team_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
    ],
    "matches": [
        IndexModel([("match_code", ASCENDING)], unique=True),
        IndexModel([("team_id", ASCENDING), ("start_at", DESCENDING)]),
        IndexModel([("captain_id", ASCENDING), ("match_status", ASCENDING), ("start_at", ASCENDING)]),
        IndexModel([("location", GEOSPHERE), ("match_status", ASCENDING), ("start_at", ASCENDING)], name="match_geo"),
        IndexModel([("match_status", ASCENDING), ("start_at", ASCENDING)]),
    ],
    "match_rosters": [
        IndexModel(
            [("match_id", ASCENDING), ("player_id", ASCENDING)],
            unique=True,
            partialFilterExpression=_ACTIVE,
            name="uniq_active_seat",
        ),
        IndexModel([("player_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("match_id", ASCENDING), ("status", ASCENDING)]),
    ],
    "availability": [
        IndexModel(
            [("location", GEOSPHERE), ("status", ASCENDING), ("start_at", ASCENDING), ("end_at", ASCENDING)],
            name="availability_geo",
        ),
        IndexModel([("player_id", ASCENDING), ("start_at", ASCENDING)]),
        IndexModel(
            [("player_id", ASCENDING), ("start_at", ASCENDING), ("end_at", ASCENDING)], unique=True, name="uniq_slot"
        ),
        IndexModel([("end_at", ASCENDING)]),  # nightly cleanup of old slots
    ],
    "invitations": [
        IndexModel(
            [("match_id", ASCENDING), ("player_id", ASCENDING)],
            unique=True,
            partialFilterExpression=_ACTIVE,
            name="uniq_active_invitation",
        ),
        IndexModel([("player_id", ASCENDING), ("invitation_status", ASCENDING), ("invited_at", DESCENDING)]),
        IndexModel([("match_id", ASCENDING), ("invitation_status", ASCENDING)]),
        IndexModel([("captain_id", ASCENDING), ("invited_at", DESCENDING)]),  # manager inbox ($or clause 1)
        IndexModel([("team_id", ASCENDING), ("invited_at", DESCENDING)]),  # manager inbox ($or clause 2)
        IndexModel([("captain_id", ASCENDING), ("direction", ASCENDING), ("invitation_status", ASCENDING)]),
        IndexModel([("invitation_status", ASCENDING), ("expires_at", ASCENDING)]),
    ],
    "expenses": [IndexModel([("match_id", ASCENDING)])],
    "settlements": [
        IndexModel([("match_id", ASCENDING), ("version", ASCENDING)], unique=True),
        IndexModel([("settlement_code", ASCENDING)], unique=True),
        IndexModel([("lines.player_id", ASCENDING), ("settlement_status", ASCENDING)]),  # "my dues"
        IndexModel(
            [("match_id", ASCENDING)],
            unique=True,
            name="one_draft_per_match",
            partialFilterExpression={"settlement_status": "draft"},
        ),
        IndexModel(
            [("match_id", ASCENDING)],
            unique=True,
            name="one_published_per_match",
            partialFilterExpression={"settlement_status": "published"},
        ),
    ],
    "payment_records": [
        IndexModel([("settlement_id", ASCENDING), ("player_id", ASCENDING)], unique=True),
        IndexModel([("player_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)]),
        IndexModel([("captain_id", ASCENDING), ("status", ASCENDING)]),
    ],
    "payment_discussions": [IndexModel([("payment_record_id", ASCENDING), ("created_at", ASCENDING)])],
    "ratings": [
        IndexModel([("match_id", ASCENDING), ("reviewer_id", ASCENDING), ("reviewed_user_id", ASCENDING)], unique=True),
        IndexModel([("reviewed_user_id", ASCENDING), ("rating_type", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("reviewer_id", ASCENDING)]),  # data export / ratings given
        IndexModel([("team_id", ASCENDING), ("rating_type", ASCENDING), ("status", ASCENDING)]),
    ],
    "notifications": [
        IndexModel([("user_id", ASCENDING), ("read_at", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("created_at", ASCENDING)], expireAfterSeconds=180 * 24 * 3600),
    ],
    "reports": [
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("target_user_id", ASCENDING)]),
        IndexModel([("reporter_id", ASCENDING)]),
    ],
    "agreements": [IndexModel([("version", ASCENDING)], unique=True)],
    "user_agreements": [IndexModel([("user_id", ASCENDING), ("agreement_version", ASCENDING)], unique=True)],
    "audit_logs": [
        IndexModel([("entity_type", ASCENDING), ("entity_id", ASCENDING), ("timestamp", DESCENDING)]),
        IndexModel([("actor_id", ASCENDING), ("timestamp", DESCENDING)]),
    ],
    "whatsapp_outbox": [
        IndexModel([("created_at", ASCENDING)], expireAfterSeconds=86400, name="ttl_24h"),
        IndexModel([("to", ASCENDING), ("created_at", DESCENDING)]),
    ],
    # Processing logs: kept at least one year (DPDP Rules, 2025), then deleted.
    "whatsapp_events": [IndexModel([("received_at", ASCENDING)], expireAfterSeconds=400 * 86400, name="ttl_400d")],
    "rate_limits": [IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0)],
    "push_receipts": [
        IndexModel([("created_at", ASCENDING)], expireAfterSeconds=7 * 86400, name="ttl_7d"),
        IndexModel([("receipt_id", ASCENDING)]),
    ],
    "privacy_requests": [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("status", ASCENDING), ("legal_deadline", ASCENDING)]),
        IndexModel([("reference", ASCENDING)], unique=True),
    ],
    "chat_messages": [IndexModel([("invitation_id", ASCENDING), ("created_at", ASCENDING)])],
    "racket_profiles": [
        IndexModel([("user_id", ASCENDING), ("sport", ASCENDING)], unique=True, name="uniq_user_sport"),
        IndexModel([("location", GEOSPHERE)]),
    ],
    "play_requests": [
        IndexModel([("to_user_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("from_user_id", ASCENDING), ("sport", ASCENDING), ("created_at", DESCENDING)]),
    ],
    "courts": [
        IndexModel([("location", GEOSPHERE)]),
        IndexModel([("sports", ASCENDING)]),
    ],
    "venues": [
        IndexModel([("location", GEOSPHERE)]),
        IndexModel([("name", TEXT), ("area", TEXT)], name="venue_text"),
    ],
}

# JSON-schema validators on collections where integrity matters most.
VALIDATORS: dict[str, dict[str, Any]] = {
    "payment_records": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "settlement_id",
                "match_id",
                "player_id",
                "amount_paise",
                "currency",
                "status",
                "verification",
            ],
            "properties": {
                "amount_paise": {"bsonType": ["int", "long"], "minimum": 0},
                "credited_paise": {"bsonType": ["int", "long"], "minimum": 0},
                "currency": {"enum": ["INR"]},
                "status": {"enum": ["pending", "paid", "exempted", "disputed"]},
                "verification": {"enum": ["manual_captain_confirmed"]},
            },
        }
    },
    "settlements": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["match_id", "version", "settlement_status", "total_expenses_paise", "lines"],
            "properties": {
                "total_expenses_paise": {"bsonType": ["int", "long"], "minimum": 0},
                "settlement_status": {"enum": ["draft", "published", "superseded"]},
            },
        }
    },
    "availability": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["player_id", "start_at", "end_at", "status", "location"],
            "properties": {
                "status": {"enum": ["available", "unavailable", "tentative"]},
                "location": {
                    "bsonType": "object",
                    "required": ["type", "coordinates"],
                    "properties": {"type": {"enum": ["Point"]}},
                },
            },
        }
    },
    "ratings": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["match_id", "reviewer_id", "reviewed_user_id", "rating_type", "scores"],
            "properties": {"rating_type": {"enum": ["player", "captain"]}},
        }
    },
}


# (collection, index name) dropped at startup before INDEXES are created.
RETIRED_INDEXES: list[tuple[str, str]] = [
    ("whatsapp_events", "ttl_30d"),  # now ttl_400d (log retention >= 1 year)
    ("otp_codes", "otp_send_log_ttl"),  # now otp_send_log_ttl_24h (daily OTP budgets)
]


async def ensure_indexes(mongo: Mongo) -> None:
    existing = set(await mongo.db.list_collection_names())
    for name, validator in VALIDATORS.items():
        if name not in existing:
            try:
                await mongo.db.create_collection(name, validator=validator)
            except CollectionInvalid:
                pass
        else:
            await mongo.db.command({"collMod": name, "validator": validator})
    for coll, index in RETIRED_INDEXES:  # replaced indexes whose key pattern is reused with new options
        if coll in existing and index in await mongo[coll].index_information():
            await mongo[coll].drop_index(index)
    for name, models in INDEXES.items():
        await mongo[name].create_indexes(models)
