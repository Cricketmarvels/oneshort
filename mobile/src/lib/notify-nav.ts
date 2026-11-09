/**
 * One deep-link map for both notification channels (the in-app inbox and push taps), so a notification
 * opens the same screen however it arrives. Payloads are never trusted for state: the target screen
 * refetches from the API, and authorization stays entirely server-side.
 */
import { router } from "expo-router";

export type NotifyData = Record<string, string | undefined>;

export function openNotification(type: string | undefined, d: NotifyData): void {
  // Match invitations are accepted/declined on Home, where the invitation card lives.
  if (type === "player_invitation") return router.push("/");
  if (d.invitation_id && (type === "chat_message" || type === "invitation_accepted"))
    return router.push({ pathname: "/chat/[id]", params: { id: d.invitation_id } });
  if (d.fixture_id) return router.push({ pathname: "/fixture/[id]", params: { id: d.fixture_id } });
  if (d.challenge_id) return router.push({ pathname: "/challenge/[id]", params: { id: d.challenge_id } });
  if (d.community_id) return router.push({ pathname: "/community/[id]", params: { id: d.community_id } });
  if (d.team_id) return router.push({ pathname: "/team/[id]", params: { id: d.team_id } });
  if (d.match_id) return router.push({ pathname: "/match/[id]", params: { id: d.match_id } });
  router.push("/notifications");
}
