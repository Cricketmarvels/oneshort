from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.common.enums import (
    ContributionType,
    ExpenseCategory,
    PaymentMethod,
    PaymentStatus,
    RoundingMode,
    SettlementStatus,
)
from app.common.types import ObjectIdStr, StrictModel
from app.common.validators import LongText, Name, ShortText, UpiId
from app.modules.users.schemas import PublicUserOut


class ExpenseIn(StrictModel):
    label: ShortText
    category: ExpenseCategory = ExpenseCategory.OTHER
    amount_paise: int = Field(gt=0, le=10_000_000)
    notes: ShortText | None = None


class ExpenseOut(BaseModel):
    id: str
    label: str
    category: ExpenseCategory
    amount_paise: int
    notes: str | None
    added_by: str
    created_at: datetime


class AdjustmentIn(StrictModel):
    player_id: ObjectIdStr
    amount_paise: int = Field(ge=0, le=10_000_000)


class ExtraPlayerIn(StrictModel):
    """Someone sharing the fee who isn't in the squad: a registered player (``user_id``) or a guest typed
    in by name. A guest has no account; send back the ``guest_id`` from an earlier split to keep the
    same person (and anything they already paid) across recalculations and revisions."""

    name: Name
    user_id: ObjectIdStr | None = None
    guest_id: ObjectIdStr | None = None


class ManualDueIn(StrictModel):
    """An earlier balance kept outside OneShort (e.g. a WhatsApp list): positive = still owes, negative = paid in
    advance. Lands on a player in this split: ``player_id`` for a squad player, app player or known guest;
    ``name`` for a guest added by name in this same request."""

    player_id: ObjectIdStr | None = None
    name: Name | None = None
    amount_paise: int = Field(ge=-10_000_000, le=10_000_000)
    note: ShortText | None = Field(default=None, description="e.g. 'Previous match dues' or 'Advance'")


class OtherDueIn(StrictModel):
    """An earlier balance of someone who is NOT playing this match (kept from a WhatsApp list so nobody is
    forgotten): positive = still owes, negative = holds an advance. Listed in the group message, never added
    to anyone's fee here, and carried to the team's next split."""

    name: Name
    amount_paise: int = Field(ge=-10_000_000, le=10_000_000)
    note: ShortText | None = None


class SettlementDraftIn(StrictModel):
    rounding_mode: RoundingMode = RoundingMode.EXACT_PAISE
    player_ids: list[ObjectIdStr] | None = Field(
        default=None, max_length=40, description="Squad players sharing the fee (ticked). Omit for the whole squad."
    )
    extra_players: list[ExtraPlayerIn] = Field(
        default_factory=list, max_length=15, description="Last-minute players and guests outside the squad"
    )
    exempt_player_ids: list[ObjectIdStr] = Field(default_factory=list, max_length=40)
    adjustments: list[AdjustmentIn] = Field(default_factory=list, max_length=40)
    contribution_overrides: dict[str, ContributionType] = Field(
        default_factory=dict, description="player_id → payee/non_payee override for this settlement"
    )
    payment_instructions: LongText | None = Field(
        default=None, description="e.g. 'UPI to rahul@okaxis or cash at the ground'. Never a PIN."
    )
    revision_reason: ShortText | None = None
    upi_id: UpiId | None = Field(
        default=None, description="Captain's UPI ID for this fee. Remembered on the account for the next split."
    )
    carry_record_ids: list[ObjectIdStr] = Field(
        default_factory=list,
        max_length=60,
        description="Unpaid fee records from this team's earlier matches to add to the players' amounts here",
    )
    manual_dues: list[ManualDueIn] = Field(
        default_factory=list, max_length=40, description="Earlier dues or advances tracked outside OneShort"
    )
    other_dues: list[OtherDueIn] = Field(
        default_factory=list,
        max_length=60,
        description="Earlier balances of people not playing this match; listed in the message, not charged here",
    )


class OtherDueOut(BaseModel):
    name: str
    amount_paise: int = Field(description="+ still owes, - holds an advance")
    note: str | None = None


class CarriedDueOut(BaseModel):
    """An unpaid fee from an earlier match of the same team, added to a player's amount in this split."""

    record_id: str
    match_id: str
    match_title: str
    match_start_at: datetime | None
    amount_paise: int


class PreviousDueOut(BaseModel):
    """What one player still owes from this team's earlier matches (unpaid, not yet moved to another fee)."""

    player_id: str = Field(description="User id; for a guest, the id from their most recent match")
    name: str
    guest: bool
    total_paise: int
    items: list[CarriedDueOut]


class SettlementLineOut(BaseModel):
    player: PublicUserOut
    contribution_type: ContributionType
    eligible: bool
    exempt: bool
    adjusted: bool
    amount_paise: int
    credited_paise: int
    guest: bool = Field(default=False, description="Added by name only; has no OneShort account")
    added: bool = Field(default=False, description="Not in the squad; added to this split by the captain")
    share_paise: int = Field(default=0, description="This match's share; amount_paise = share + carried")
    carried_paise: int = Field(default=0, description="Unpaid fees from earlier matches added to this line")
    carried: list[CarriedDueOut] = Field(default_factory=list)
    prior_paise: int = Field(default=0, description="Earlier balance from outside OneShort: + owes, - advance")
    prior_note: str | None = None


class ExpenseSnapshot(BaseModel):
    label: str
    category: str
    amount_paise: int


class SettlementOut(BaseModel):
    id: str
    settlement_code: str
    match_id: str
    version: int
    settlement_status: SettlementStatus
    revises_settlement_id: str | None
    revision_reason: str | None
    expenses: list[ExpenseSnapshot]
    total_expenses_paise: int
    eligible_players: int
    individual_contribution_paise: int
    rounding_mode: RoundingMode
    rounding_adjustment_paise: int
    total_assigned_paise: int
    lines: list[SettlementLineOut]
    payment_instructions: str | None
    upi_id: str | None = None
    carried_paise: int = Field(default=0, description="Earlier unpaid fees added across all lines")
    prior_paise: int = Field(default=0, description="Net earlier balances from outside OneShort across all lines")
    other_dues: list[OtherDueOut] = Field(
        default_factory=list, description="Earlier balances of people not playing this match (from outside OneShort)"
    )
    currency: Literal["INR"] = "INR"
    created_at: datetime
    published_at: datetime | None


class MarkPaidIn(StrictModel):
    method: PaymentMethod = PaymentMethod.UPI
    remarks: ShortText | None = None


class RemarksIn(StrictModel):
    remarks: ShortText | None = None


class DisputeIn(StrictModel):
    reason: ShortText


class CorrectIn(StrictModel):
    status: PaymentStatus
    reason: ShortText = Field(description="Mandatory explanation, stored in the audit trail")


class DiscussionIn(StrictModel):
    message: str = Field(min_length=1, max_length=1000)


class StatusChange(BaseModel):
    from_status: str | None
    to_status: str
    by: str | None
    at: datetime
    reason: str | None


class PaymentRecordOut(BaseModel):
    id: str
    settlement_id: str
    match_id: str
    match_title: str
    match_start_at: datetime
    team_id: str
    team_name: str
    player: PublicUserOut
    player_is_guest: bool = False
    captain: PublicUserOut
    amount_paise: int
    credited_paise: int
    balance_paise: int
    currency: Literal["INR"] = "INR"
    status: PaymentStatus
    method: PaymentMethod | None
    verification: Literal["manual_captain_confirmed"] = Field(
        default="manual_captain_confirmed",
        description="MVP: payments are recorded manually by the captain; never gateway-verified",
    )
    remarks: str | None
    dispute_reason: str | None
    carried_paise: int = Field(default=0, description="Part of amount_paise that is earlier matches' unpaid fees")
    prior_paise: int = Field(default=0, description="Earlier balance from outside OneShort: + owes, - advance")
    prior_note: str | None = None
    carried_to_match_title: str | None = Field(
        default=None, description="For a carried_forward record: the match fee it was moved to"
    )
    updated_by: str | None
    updated_at: datetime
    history: list[StatusChange]


class CaptainDashboardOut(BaseModel):
    settlement: SettlementOut
    total_paise: int
    eligible_players: int
    individual_contribution_paise: int
    collected_paise: int
    outstanding_paise: int
    exempted_count: int
    disputed_count: int
    records: list[PaymentRecordOut]


class PlayerDashboardOut(BaseModel):
    outstanding_paise: int
    paid_paise: int
    pending_count: int
    disputed_count: int
    exempted_count: int
    records: list[PaymentRecordOut]


class TeamSpendOut(BaseModel):
    team_id: str
    team_name: str
    paid_paise: int = Field(description="Fees marked paid for matches inside the period")
    owed_paise: int = Field(description="Still outstanding to this team's captain, regardless of period")
    matches: int = Field(description="Fee records inside the period, exempt ones excluded")


class MonthTeamSpendOut(BaseModel):
    team_id: str
    paid_paise: int


class MonthSpendOut(BaseModel):
    month: str = Field(description="YYYY-MM, by the match date in Asia/Kolkata")
    paid_paise: int
    by_team: list[MonthTeamSpendOut]


class SpendOut(BaseModel):
    """What one player has spent on match fees, grouped for the Manage Fees screen.

    Spend is dated by the match, not by when the captain ticked it paid, so a month answers
    "what did October's cricket cost me". Outstanding amounts are never filtered by period:
    a debt from last year is still a debt.
    """

    year: int | None
    month: int | None
    years: list[int] = Field(description="Years that have any fee record, newest first")
    paid_paise: int
    owed_paise: int
    matches: int
    teams: list[TeamSpendOut] = Field(description="Most spent first")
    months: list[MonthSpendOut] = Field(description="Oldest first, only months with a paid fee")


class DiscussionOut(BaseModel):
    id: str
    author: PublicUserOut
    message: str
    created_at: datetime


class ShareOut(BaseModel):
    text: str
    whatsapp_url: str
    note: str = "Opens WhatsApp with the message pre-filled. Delivery is not tracked by the app."


class FeeDueOut(BaseModel):
    """A finished match whose fee the captain still has to split or collect (home dashboard card)."""

    match_id: str
    settlement_id: str | None = Field(
        default=None, description="The shared split (collecting) or the unshared draft; used for one-tap reminders"
    )
    title: str
    start_at: datetime
    venue_name: str | None
    squad_size: int
    stage: Literal["not_split", "draft", "collecting"]
    total_paise: int = Field(description="Expenses added so far (or the published total)")
    collected_paise: int
    outstanding_paise: int
    pending_count: int
    paid_count: int


class RemindAllOut(BaseModel):
    reminded: int = Field(description="Players on OneShort who got a personal reminder (in-app, push, WhatsApp)")
    guests: list[str] = Field(description="Unpaid guests with no account: send them the group message yourself")
    next_allowed_at: datetime
