import { formatDateTime, formatPaise, INVITATION_STATUS_LABELS, type Invitation } from "@cm/shared";
import { Check, Clock, X } from "lucide-react";
import { Link } from "react-router";

import { RoleBadge } from "@/components/players/RoleBadge";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { invitations } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

const INV = [["invitations"], ["dashboard"], ["matches"], ["roster"]];

export function InvitationCard({ inv }: { inv: Invitation }) {
  const isRequest = inv.direction === "request";
  const accept = useAction(() => invitations.accept(inv.id), { invalidate: INV, success: "Accepted! The captain will confirm your spot." });
  const reject = useAction(() => invitations.reject(inv.id), { invalidate: INV, success: "Declined" });
  const confirm = useAction(() => invitations.confirm(inv.id), { invalidate: INV, success: `${inv.player.full_name} is in the squad` });
  const cancel = useAction(() => invitations.cancel(inv.id), { invalidate: INV, success: "Cancelled" });
  const other = inv.can_confirm || (isRequest && inv.can_reject) ? inv.player : inv.captain;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={other.full_name} src={other.profile_image} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-500">
            {inv.can_confirm || (isRequest && inv.can_reject)
              ? <><Link to={`/players/${inv.player.id}`} className="font-semibold text-ink-900">{inv.player.full_name}</Link> {isRequest ? "wants to join" : "accepted your invite to"}</>
              : isRequest ? <>Your request to join</> : <><span className="font-semibold text-ink-900">{inv.captain.full_name}</span> invited you to</>}
          </p>
          <Link to={`/matches/${inv.match.id}`} className="block truncate font-semibold hover:underline">{inv.match.title} · {inv.match.team_name}</Link>
          <p className="mt-0.5 text-sm text-ink-500">{formatDateTime(inv.match.start_at, inv.match.timezone)} · {inv.match.area}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={inv.invitation_status} label={INVITATION_STATUS_LABELS[inv.invitation_status]} />
            <Badge tone={inv.contribution_type === "payee" ? "info" : "neutral"}>
              {inv.contribution_type === "payee" ? `Payee${inv.match.per_head_fee_paise ? ` · ~${formatPaise(inv.match.per_head_fee_paise)}` : ""}` : "Non-payee (free)"}
            </Badge>
            {inv.proposed_role && <RoleBadge role={inv.proposed_role} short />}
            {inv.is_substitute && <Badge tone="warning">Substitute</Badge>}
            {inv.availability_state && <StatusBadge status={inv.availability_state} label={`availability: ${inv.availability_state}`} />}
          </div>
          {inv.message && <p className="mt-2 rounded-xl bg-sand-100 p-2.5 text-sm italic text-ink-700">“{inv.message}”</p>}
          {inv.invitation_status === "pending" && (
            <p className="mt-2 flex items-center gap-1 text-xs text-ink-400"><Clock className="size-3.5" aria-hidden />Expires {formatDateTime(inv.expires_at)}</p>
          )}
        </div>
      </div>
      {(inv.can_accept || inv.can_reject || inv.can_confirm || inv.can_cancel) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-sand-200 pt-3">
          {inv.can_accept && <Button size="sm" icon={<Check className="size-4" />} loading={accept.isPending} onClick={() => accept.mutate(undefined)}>Accept</Button>}
          {inv.can_confirm && <Button size="sm" icon={<Check className="size-4" />} loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>{isRequest ? "Approve & confirm" : "Confirm in squad"}</Button>}
          {inv.can_reject && <Button size="sm" variant="secondary" icon={<X className="size-4" />} loading={reject.isPending} onClick={() => reject.mutate(undefined)}>Decline</Button>}
          {inv.can_cancel && !inv.can_reject && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>Cancel</Button>}
        </div>
      )}
    </Card>
  );
}
