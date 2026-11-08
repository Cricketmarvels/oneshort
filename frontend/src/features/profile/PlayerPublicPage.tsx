import { Flag } from "lucide-react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState, Spinner } from "@/components/ui/states";
import { usePublicPlayer } from "@/services/api/endpoints";

import { ProfileView } from "./ProfileView";

export function PlayerPublicPage() {
  const { id = "" } = useParams();
  const q = usePublicPlayer(id);
  return (
    <div>
      <PageHeader back title="Player" action={<Link to={`/report?user=${id}`} className="flex items-center gap-1 rounded-xl p-2 text-xs text-ink-400 hover:text-ball-600"><Flag className="size-4" />Report</Link>} />
      <QueryState query={q} skeleton={<Spinner />}>{(p) => <ProfileView p={p} />}</QueryState>
      <p className="mt-4 text-center text-xs text-ink-400">Contact details and exact location are never shown. Coordinate through matches and invitations.</p>
    </div>
  );
}
