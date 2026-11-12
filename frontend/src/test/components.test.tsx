import type { Invitation, S } from "@cm/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import { SquadComposition } from "@/components/matches/SquadComposition";
import { Field, Input } from "@/components/ui/field";
import { InvitationCard } from "@/features/invitations/InvitationCard";

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("SquadComposition", () => {
  it("shows confirmed count, vacancies and per-role needs", () => {
    const comp: S<"CompositionOut"> = {
      required: { batsman: 4, bowler: 3, wicketkeeper: 1, all_rounder: 3 },
      confirmed: { batsman: 2, bowler: 3, wicketkeeper: 0, all_rounder: 1 },
      capacity: 11, confirmed_total: 6, vacancies: 5,
    };
    wrap(<SquadComposition comp={comp} />);
    expect(screen.getByText("5 open")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
    expect(screen.getAllByText("Need 2 more")).toHaveLength(2); // batsmen + all-rounders
    expect(screen.getByText("Need 1 more")).toBeInTheDocument(); // wicketkeeper
  });
});

describe("Field", () => {
  it("wires label and error for accessibility", () => {
    render(<Field label="Mobile number" error="Enter a valid number">{(id, d) => <Input id={id} aria-describedby={d} />}</Field>);
    const input = screen.getByLabelText("Mobile number");
    expect(input).toHaveAccessibleDescription("Enter a valid number");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid number");
  });
});

const baseInv: Invitation = {
  id: "i1", direction: "invite", invitation_status: "pending", contribution_type: "non_payee", proposed_role: "bowler",
  message: "Need a seamer", is_substitute: false, commitment: "confirmed", commitment_note: null,
  player: { id: "p1", full_name: "Arjun Rao", profile_image: null, city: "Bengaluru" },
  captain: { id: "c1", full_name: "Rahul Menon", profile_image: null, city: "Bengaluru" },
  match: { id: "m1", match_code: "CM-ABC123", title: "Sunday T20", team_name: "Koramangala Kings", team_logo: null,
    start_at: "2026-11-08T01:30:00Z", end_at: "2026-11-08T04:30:00Z", timezone: "Asia/Kolkata", format: "T20",
    category: "friendly", area: "Koramangala", city: "Bengaluru", match_status: "recruiting", per_head_fee_paise: 41000 },
  availability_state: null, invited_at: "2026-11-04T00:00:00Z", responded_at: null, confirmed_at: null,
  expires_at: "2026-11-06T00:00:00Z", can_accept: true, can_reject: true, can_cancel: false, can_confirm: false, can_chat: false,
};

describe("InvitationCard", () => {
  it("shows payee status before acceptance and player actions", async () => {
    wrap(<InvitationCard inv={baseInv} />);
    expect(screen.getByText("Non-payee (free)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });
  it("shows confirm for captain once accepted", async () => {
    wrap(<InvitationCard inv={{ ...baseInv, invitation_status: "accepted", can_accept: false, can_reject: false, can_cancel: true, can_confirm: true, contribution_type: "payee" }} />);
    expect(screen.getByRole("button", { name: "Confirm in squad" })).toBeInTheDocument();
    expect(screen.getByText(/Payee · ~₹410/)).toBeInTheDocument();
    await userEvent.setup().hover(screen.getByRole("button", { name: "Confirm in squad" }));
  });
});
