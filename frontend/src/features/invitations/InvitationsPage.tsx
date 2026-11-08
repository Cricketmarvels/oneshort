import { Inbox } from "lucide-react";
import { useSearchParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs } from "@/components/ui/chip";
import { EmptyState, QueryState } from "@/components/ui/states";
import { useManagedInvitations, useMyInvitations } from "@/services/api/endpoints";

import { InvitationCard } from "./InvitationCard";

type Tab = "received" | "sent" | "requests" | "sent_by_me";

export function InvitationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "received";
  const received = useMyInvitations("received");
  const sent = useMyInvitations("sent");
  const requests = useManagedInvitations("request", "pending");
  const managed = useManagedInvitations("invite");
  const q = { received, sent, requests, sent_by_me: managed }[tab];
  const pendingCount = (received.data?.data ?? []).filter((i) => i.invitation_status === "pending").length;
  return (
    <div>
      <PageHeader title="Invitations" subtitle="Invites you've received, your join requests, and requests to your squads." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: "received", label: "Received", count: pendingCount },
        { value: "sent", label: "My requests" },
        { value: "requests", label: "Join requests", count: requests.data?.meta.total },
        { value: "sent_by_me", label: "Sent invites" },
      ]} />
      <div className="mt-4">
        <QueryState query={q} isEmpty={(d) => d.data.length === 0}
          empty={<EmptyState icon={<Inbox />} title="Nothing here yet" body={tab === "requests" ? "When players ask to join your matches, they'll appear here." : "Invitations and requests show up here."} />}>
          {(d) => <div className="grid gap-3 md:grid-cols-2">{d.data.map((i) => <InvitationCard key={i.id} inv={i} />)}</div>}
        </QueryState>
      </div>
    </div>
  );
}
