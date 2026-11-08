from enum import StrEnum


class Role(StrEnum):
    PLAYER = "player"
    CAPTAIN = "captain"
    ADMIN = "admin"


class AccountStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    RESTRICTED = "restricted"  # matchmaking restricted by moderation
    DELETED = "deleted"


class PlayingRole(StrEnum):
    BATSMAN = "batsman"
    BOWLER = "bowler"
    WICKETKEEPER = "wicketkeeper"
    ALL_ROUNDER = "all_rounder"


class BattingStyle(StrEnum):
    RIGHT_HAND = "right_hand"
    LEFT_HAND = "left_hand"


class BowlingStyle(StrEnum):
    RIGHT_ARM_FAST = "right_arm_fast"
    RIGHT_ARM_MEDIUM = "right_arm_medium"
    LEFT_ARM_FAST = "left_arm_fast"
    LEFT_ARM_MEDIUM = "left_arm_medium"
    OFF_SPIN = "off_spin"
    LEG_SPIN = "leg_spin"
    LEFT_ARM_ORTHODOX = "left_arm_orthodox"
    LEFT_ARM_WRIST_SPIN = "left_arm_wrist_spin"
    NONE = "none"


class MatchFormat(StrEnum):
    T10 = "T10"
    T20 = "T20"
    ODI = "ODI"
    OTHER = "OTHER"


class MatchCategory(StrEnum):
    CORPORATE = "corporate"
    FRIENDLY = "friendly"
    TOURNAMENT = "tournament"
    PRACTICE = "practice"


class TimeOfDay(StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"


class Weekday(StrEnum):
    MON = "mon"
    TUE = "tue"
    WED = "wed"
    THU = "thu"
    FRI = "fri"
    SAT = "sat"
    SUN = "sun"


class AvailabilityStatus(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    TENTATIVE = "tentative"


class Visibility(StrEnum):
    DISCOVERABLE = "discoverable"
    PRIVATE = "private"


class MatchStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    RECRUITING = "recruiting"
    SQUAD_CONFIRMED = "squad_confirmed"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class InvitationStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    CONFIRMED = "confirmed"


class InvitationDirection(StrEnum):
    INVITE = "invite"  # captain -> player
    REQUEST = "request"  # player -> captain (join request)


class ContributionType(StrEnum):
    PAYEE = "payee"
    NON_PAYEE = "non_payee"


class RosterStatus(StrEnum):
    CONFIRMED = "confirmed"
    WITHDRAWN = "withdrawn"
    REMOVED = "removed"
    REPLACED = "replaced"


class Attendance(StrEnum):
    PRESENT = "present"
    LATE = "late"
    NO_SHOW = "no_show"


class TeamMemberRole(StrEnum):
    CAPTAIN = "captain"
    ADMIN = "admin"
    MEMBER = "member"


class SettlementStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"


class RoundingMode(StrEnum):
    EXACT_PAISE = "exact_paise"  # distribute leftover paise one by one
    ROUND_UP_RUPEE = "round_up_rupee"  # ceil each share to whole rupee; surplus shown


class PaymentStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    EXEMPTED = "exempted"
    DISPUTED = "disputed"


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"
    PHONEPE = "phonepe"
    GPAY = "gpay"
    PAYTM = "paytm"
    BANK_TRANSFER = "bank_transfer"
    OTHER = "other"


class ExpenseCategory(StrEnum):
    GROUND = "ground"
    BALLS = "balls"
    UMPIRE = "umpire"
    REFRESHMENTS = "refreshments"
    EQUIPMENT = "equipment"
    TRAVEL = "travel"
    OTHER = "other"


class RatingType(StrEnum):
    PLAYER = "player"
    CAPTAIN = "captain"


PLAYER_RATING_CATEGORIES = ("punctuality", "behaviour", "sportsmanship", "participation", "overall")
CAPTAIN_RATING_CATEGORIES = (
    "behaviour",
    "fair_opportunities",
    "team_management",
    "communication",
    "punctuality",
    "overall",
)


class ReportCategory(StrEnum):
    ABUSIVE_LANGUAGE = "abusive_language"
    PHYSICAL_MISCONDUCT = "physical_misconduct"
    HARASSMENT = "harassment"
    THREATENING_BEHAVIOUR = "threatening_behaviour"
    UNSPORTSMANLIKE = "unsportsmanlike"
    FINANCIAL_MISCONDUCT = "financial_misconduct"
    REPEATED_NO_SHOWS = "repeated_no_shows"
    OTHER = "other"


class ReportStatus(StrEnum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ModerationAction(StrEnum):
    WARNING = "warning"
    TEMP_SUSPEND = "temp_suspend"
    PERMANENT_SUSPEND = "permanent_suspend"
    RESTRICT_MATCHMAKING = "restrict_matchmaking"
    LIFT_RESTRICTIONS = "lift_restrictions"


class NotificationType(StrEnum):
    PLAYER_INVITATION = "player_invitation"
    TEAM_INVITATION = "team_invitation"
    JOIN_REQUEST = "join_request"
    INVITATION_ACCEPTED = "invitation_accepted"
    INVITATION_REJECTED = "invitation_rejected"
    INVITATION_CANCELLED = "invitation_cancelled"
    MATCH_CONFIRMED = "match_confirmed"
    MATCH_REMINDER = "match_reminder"
    MATCH_CANCELLED = "match_cancelled"
    MATCH_RESCHEDULED = "match_rescheduled"
    PLAYER_REPLACED = "player_replaced"
    PLAYER_WITHDREW = "player_withdrew"
    SETTLEMENT_CREATED = "settlement_created"
    PAYMENT_MARKED_PAID = "payment_marked_paid"
    PAYMENT_STATUS_CHANGED = "payment_status_changed"
    PAYMENT_REMINDER = "payment_reminder"
    PAYMENT_DISPUTE = "payment_dispute"
    FEE_DISCUSSION = "fee_discussion"
    RATING_RECEIVED = "rating_received"
    RATING_REQUEST = "rating_request"
    REPORT_UPDATE = "report_update"
    TEAM_MEMBERSHIP = "team_membership"
    MODERATION = "moderation"
    TEAM_CHALLENGE = "team_challenge"
    CHALLENGE_ACCEPTED = "challenge_accepted"
    CHALLENGE_COUNTER = "challenge_counter"
    CHALLENGE_CONFIRMED = "challenge_confirmed"
    CHALLENGE_REJECTED = "challenge_rejected"
    CHALLENGE_CANCELLED = "challenge_cancelled"
    RESULT_SUBMITTED = "result_submitted"
    RESULT_CONFIRMED = "result_confirmed"
    RESULT_DISPUTED = "result_disputed"
    RATING_UPDATED = "rating_updated"
    CHAT_MESSAGE = "chat_message"
    COMMUNITY_ANNOUNCEMENT = "community_announcement"
    COMMUNITY_JOIN_REQUEST = "community_join_request"
    COMMUNITY_MEMBERSHIP = "community_membership"


class FixtureFormat(StrEnum):
    """Team-vs-team match formats (ratings are kept per format)."""

    T10 = "T10"
    T15 = "T15"
    T20 = "T20"
    OVERS_30 = "30_OVER"
    OVERS_40 = "40_OVER"
    CUSTOM = "CUSTOM"


class ChallengeStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    COUNTER_PROPOSED = "counter_proposed"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


ACTIVE_CHALLENGE_STATUSES = (
    ChallengeStatus.DRAFT,
    ChallengeStatus.PENDING,
    ChallengeStatus.ACCEPTED,
    ChallengeStatus.COUNTER_PROPOSED,
    ChallengeStatus.CONFIRMED,
)


class FixtureStatus(StrEnum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ResultStatus(StrEnum):
    SUBMITTED = "submitted"  # awaiting the opposing captain
    CONFIRMED = "confirmed"  # official: counts for ratings and records
    DISPUTED = "disputed"  # held; never affects ratings
    VOIDED = "voided"  # removed by an administrator


class ResultType(StrEnum):
    WON = "won"
    TIED = "tied"
    NO_RESULT = "no_result"


class CommunityKind(StrEnum):
    LOCALITY = "locality"
    SECTOR = "sector"
    CITY = "city"
    INTEREST = "interest"
    CORPORATE = "corporate"
    WEEKEND = "weekend"
    COMPETITIVE = "competitive"


class CommunityRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MODERATOR = "moderator"
    MEMBER = "member"


class CommunityPostType(StrEnum):
    POST = "post"
    ANNOUNCEMENT = "announcement"
    POLL = "poll"
    MATCH = "match"
    TOURNAMENT = "tournament"
