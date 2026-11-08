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

async function copy(text: string): Promise<boolean> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator;
  if (Platform.OS === "web" && nav?.clipboard) { await nav.clipboard.writeText(text); return true; }
  await Share.share({ message: text });
  return false;
}

/** Card on the match page / captain home. `confirmed`/`capacity` come from the match composition. */
export function InviteRegularsCard({ matchId, confirmed, capacity, showFindPlayers = true }: { matchId: string; confirmed: number; capacity: number; showFindPlayers?: boolean }) {
  const qc = useQueryClient();
  const q = useInviteLink(matchId);
  const [note, setNote] = useState<string | null>(null);
  const rotate = useMutation({
    mutationFn: () => api<Link>(`/matches/${matchId}/invite-link`, { method: "POST", query: { rotate: true } }),
    onSuccess: (l) => { qc.setQueryData(["invite-link", matchId], l); setNote("New link created — the old one no longer works."); },
    onError: (e) => setNote(errorText(e)),
  });
  const open = Math.max(0, capacity - confirmed);
  const l = q.data;
  const url = l ? joinUrl(l.path, l.url) : "";
  return (
    <View style={{ gap: 12, padding: SP.lg, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.primary, alignItems: "center", justifyContent: "center" }}><Txt v="smallSemi" color="#FFFFFF">1</Txt></View>
        <Txt v="h3" style={{ flex: 1, fontSize: 17 }}>Invite your regulars first</Txt>
      </View>
      <Txt v="small" color={T.muted} style={{ fontSize: 14 }}>
        Share this link in your team's WhatsApp group. Regulars sign up (if new) and add themselves to the squad — first come, first served.
      </Txt>
      {q.isPending ? <Txt v="small" color={T.muted}>Creating your link…</Txt> : q.isError ? <Txt v="small" color={T.dangerText}>{errorText(q.error)}</Txt> : l ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line }}>
            <PlayRIcon name="link" size={16} color={T.muted} />
            <Txt v="small" numberOfLines={1} style={{ flex: 1 }}>{url}</Txt>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Share on WhatsApp" icon={<PlayRIcon name="chat" size={18} color="#FFFFFF" />} onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText(l))}`)} style={{ flex: 1.4 }} />
            <Button title="Copy" variant="secondary" icon={<PlayRIcon name="copy" size={17} color={T.ink} />} onPress={() => void copy(shareText(l)).then((ok) => ok && setNote("Message and link copied — paste it in your group."))} style={{ flex: 1 }} />
          </View>
          <View style={{ gap: 4 }}>
            <Txt v="smallSemi">{l.joined.length ? `${l.joined.length} joined via link: ${l.joined.join(", ")}` : "No one has joined via the link yet"}</Txt>
            <Txt v="small" color={T.muted}>{confirmed} / {capacity} in the squad · {open} spot{open === 1 ? "" : "s"} left · link works until the match ends</Txt>
          </View>
          {note ? <Txt v="small" color={T.primaryDark}>{note}</Txt> : null}
          <Pressable accessibilityRole="button" onPress={() => rotate.mutate()} hitSlop={8} style={{ alignSelf: "flex-start" }}>
            <Txt v="small" color={T.muted} style={{ textDecorationLine: "underline" }}>Make a new link (stops the old one)</Txt>
          </Pressable>
        </>
      ) : null}
      {showFindPlayers ? (
        <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.line }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: open ? T.primarySoft : T.surface2, alignItems: "center", justifyContent: "center" }}><Txt v="smallSemi" color={T.primaryDark}>2</Txt></View>
            <Txt v="h3" style={{ flex: 1 }}>{open ? "Still short? Find players" : "Squad is full"}</Txt>
          </View>
          {open ? (
            <>
              <Txt v="small" color={T.muted}>Once your regulars have replied, fill the remaining {open} spot{open === 1 ? "" : "s"} with available players nearby.</Txt>
              <Button title={`Find players for ${open} spot${open === 1 ? "" : "s"}`} variant="secondary" icon={<PlayRIcon name="search" size={17} color={T.ink} />} onPress={() => router.push({ pathname: "/match/players", params: { match: matchId } })} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
