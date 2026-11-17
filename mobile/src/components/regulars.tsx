/**
 * "Invite your regulars" — step 1 for a captain before Find Players. One link per match: share it in the team's
 * WhatsApp group; regulars register (if new) and add themselves to the team + squad, first come first served.
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, Platform, Pressable, Share, View } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { Button, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { joinUrl } from "@/lib/joinlink";
import { R, SP, T } from "@/theme";

type Link = S<"InviteLinkOut">;

export function useInviteLink(matchId: string, enabled = true) {
  return useQuery({ enabled, queryKey: ["invite-link", matchId], queryFn: () => api<Link>(`/matches/${matchId}/invite-link`, { method: "POST" }), refetchInterval: 20_000 });
}

export function shareText(link: Link) {
  return `${link.message}\n${joinUrl(link.path, link.url)}`;
}

/** Copy to the clipboard on web (true); on phones open the share sheet instead (false). */
export async function copyText(text: string): Promise<boolean> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator;
  if (Platform.OS === "web" && nav?.clipboard) { await nav.clipboard.writeText(text); return true; }
  await Share.share({ message: text });
  return false;
}

/** Compact invite card on the match page. `confirmed`/`capacity` come from the match composition. */
export function InviteRegularsCard({ matchId, confirmed, capacity, showFindPlayers = true }: { matchId: string; confirmed: number; capacity: number; showFindPlayers?: boolean }) {
  const qc = useQueryClient();
  const q = useInviteLink(matchId);
  const [note, setNote] = useState<string | null>(null);
  const flash = (t: string) => { setNote(t); setTimeout(() => setNote(null), 3000); };
  const rotate = useMutation({
    mutationFn: () => api<Link>(`/matches/${matchId}/invite-link`, { method: "POST", query: { rotate: true } }),
    onSuccess: (l) => { qc.setQueryData(["invite-link", matchId], l); flash("New link ready. The old one stopped working."); },
    onError: (e) => flash(errorText(e)),
  });
  const open = Math.max(0, capacity - confirmed);
  const l = q.data;
  return (
    <View style={{ gap: 12, padding: SP.lg, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Txt v="h3" style={{ flex: 1, fontSize: 17 }}>Invite your regulars</Txt>
        {l ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Reset invite link" onPress={() => rotate.mutate()} hitSlop={8}>
            <Txt v="small" color={T.muted}>Reset link</Txt>
          </Pressable>
        ) : null}
      </View>
      {q.isPending ? <Txt v="small" color={T.muted}>Creating your link…</Txt> : q.isError ? <Txt v="small" color={T.dangerText}>{errorText(q.error)}</Txt> : l ? (
        <>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="WhatsApp" icon={<PlayRIcon name="chat" size={18} color="#FFFFFF" />} onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText(l))}`)} style={{ flex: 1 }} />
            <Button title="Copy link" variant="secondary" icon={<PlayRIcon name="copy" size={17} color={T.ink} />} onPress={() => void copyText(shareText(l)).then((ok) => ok && flash("Copied. Paste it in your group."))} style={{ flex: 1 }} />
          </View>
          {note ? <Txt v="small" color={T.primaryDark}>{note}</Txt>
            : l.joined.length ? <Txt v="small" color={T.muted} numberOfLines={1}>Joined via link: {l.joined.join(", ")}</Txt> : null}
        </>
      ) : null}
      {showFindPlayers && open ? (
        <Button title={`Find players for ${open} spot${open === 1 ? "" : "s"}`} variant="secondary" icon={<PlayRIcon name="search" size={17} color={T.ink} />} onPress={() => router.push({ pathname: "/match/players", params: { match: matchId } })} />
      ) : null}
    </View>
  );
}
