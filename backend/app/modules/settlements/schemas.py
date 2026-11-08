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
from app.common.validators import LongText, ShortText
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


class SettlementDraftIn(StrictModel):
    rounding_mode: RoundingMode = RoundingMode.EXACT_PAISE
    exempt_player_ids: list[ObjectIdStr] = Field(default_factory=list, max_length=22)
    adjustments: list[AdjustmentIn] = Field(default_factory=list, max_length=22)
    contribution_overrides: dict[str, ContributionType] = Field(
        default_factory=dict, description="player_id → payee/non_payee override for this settlement"
    )
    payment_instructions: LongText | None = Field(
        default=None, description="e.g. 'UPI to rahul@okaxis or cash at the ground'. Never a PIN."
    )
    revision_reason: ShortText | None = None


class SettlementLineOut(BaseModel):
    player: PublicUserOut
    contribution_type: ContributionType
    eligible: bool
    exempt: bool
    adjusted: bool
    amount_paise: int
    credited_paise: int


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


class DiscussionOut(BaseModel):
    id: str
    author: PublicUserOut
    message: str
    created_at: datetime


class ShareOut(BaseModel):
    text: str
    whatsapp_url: str
    note: str = "Opens WhatsApp with the message pre-filled. Delivery is not tracked by the app."
