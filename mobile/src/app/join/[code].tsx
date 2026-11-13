/**
 * Captain invite link (/join/<code>): what a regular sees after tapping the link in the team's WhatsApp group.
 * Shows the match (area only, no exact venue), then: new here → create an account; have one → log in;
 * signed in → pick a role if needed → "Add me to the squad" (joins the team and the match squad).
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarDays, CheckCircle2, MapPin, Users } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/premium";
import { Button, Chip, InlineNotice, LoadingSkeleton, Txt } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { usePendingJoin } from "@/lib/joinlink";
import { FW, R, SP, T } from "@/theme";

type Preview = S<"JoinPreviewOut">;
type Result = S<"JoinResultOut">;
const ROLES = [["batsman", "Batter"], ["bowler", "Bowler"], ["all_rounder", "All-rounder"], ["wicketkeeper", "Wicketkeeper"]] as const;

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const pending = usePendingJoin();
  useEffect(() => { if (code && pending.code !== code) pending.set(code); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const pv = useQuery({ queryKey: ["join", code], queryFn: () => api<Preview>(`/join/${code}`), retry: false });
  const profile = useQuery({ enabled: !!user, queryKey: ["player", "me"], queryFn: () => api<{ primary_role: string }>("/players/me").catch(() => null) });
  const [role, setRole] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  const join = useMutation({
    mutationFn: async () => {
      if (!profile.data) {
        if (!role) throw new Error("Pick your main role first");
        await api("/players/me", { method: "PUT", body: { primary_role: role } });
      }
      return api<Result>(`/join/${code}`, { method: "POST", body: role ? { proposed_role: role } : {} });
    },
    onSuccess: (r) => { setErr(null); setDone(r); pending.clear(); void pv.refetch(); },
    onError: (e) => setErr(e instanceof ApiError ? errorText(e) : (e as Error).message),
  });

  const p = pv.data;
  const notFound = pv.isError && pv.error instanceof ApiError && pv.error.status === 404;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ padding: SP.page, paddingTop: insets.top + 14, paddingBottom: 48, gap: 18 }} keyboardShouldPersistTaps="handled">
        <Wordmark size={26} />
        {pv.isPending ? <LoadingSkeleton rows={3} /> : notFound || !p ? (
          <View style={{ gap: 10 }}>
            <Txt v="hero">Link not found</Txt>
            <Txt v="body" color={T.muted}>This invite link isn't valid. Ask your captain to share it again.</Txt>
            <Button title="Open OneShort" onPress={() => { pending.clear(); router.replace("/"); }} />
          </View>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <Txt v="small" color={T.primaryDark} style={{ ...FW.bold, letterSpacing: 0.6 }}>YOU'RE INVITED</Txt>
              <Txt v="hero" style={{ fontSize: 26, lineHeight: 32 }}>Join {p.team_name}</Txt>
              <Txt v="body" color={T.muted}>{p.captain_name} (captain) is filling the squad for this match.</Txt>
            </View>
            <View style={{ borderRadius: 22, padding: 18, gap: 10, backgroundColor: T.heroInk }}>
              <Txt v="h2" color="#FFFFFF">{p.match_title}</Txt>
              <Row icon={CalendarDays} text={`${when(p.start_at, { weekday: "long", day: "numeric", month: "short" })} · ${when(p.start_at, { hour: "numeric", minute: "2-digit" })}–${when(p.end_at, { hour: "numeric", minute: "2-digit" })}`} />
              <Row icon={MapPin} text={[p.area, p.city].filter(Boolean).join(", ") + " · exact venue shared once you're in"} />
              <Row icon={Users} text={`${p.confirmed} of ${p.capacity} in the squad · ${p.spots_left} spot${p.spots_left === 1 ? "" : "s"} left${p.format ? ` · ${p.format === "OTHER" ? "Practice" : p.format}` : ""}`} />
            </View>

            {done ? (
              <View style={{ gap: 12, padding: 18, borderRadius: R.card, backgroundColor: T.successBackground, alignItems: "center" }}>
                <CheckCircle2 size={40} color={T.successText} />
                <Txt v="h2" color={T.successText} style={{ textAlign: "center" }}>{done.status === "joined" ? "You're in the squad!" : "You're already in the squad"}</Txt>
                <Txt v="body" color={T.successText} style={{ textAlign: "center" }}>{done.team_name} · {done.match_title}. The captain can see you in the squad list.</Txt>
                <Button title="Open the match" onPress={() => router.replace({ pathname: "/match/[id]", params: { id: done.match_id } })} style={{ alignSelf: "stretch" }} />
                <Button title="Go to Home" variant="secondary" onPress={() => router.replace("/")} style={{ alignSelf: "stretch" }} />
              </View>
            ) : p.status !== "open" ? (
              <InlineNotice tone="warning">{p.status === "full" ? "The squad is already full. Your captain may still add substitutes." : p.status === "expired" ? "This invite link has expired. Ask your captain for a new one." : "The captain has closed this invite link."}</InlineNotice>
            ) : user ? (
              <View style={{ gap: 14 }}>
                <Txt v="body">Signed in as <Txt v="bodyMed">{user.full_name}</Txt></Txt>
                {profile.isPending ? <LoadingSkeleton rows={1} /> : !profile.data ? (
                  <View style={{ gap: 8 }}>
                    <Txt v="h3">Your main role</Txt>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{ROLES.map(([v, l]) => <Chip key={v} label={l} active={role === v} onPress={() => setRole(v)} />)}</View>
                  </View>
                ) : null}
                {err ? <InlineNotice tone="warning">{err}</InlineNotice> : null}
                <Button title="Add me to the squad" size="lg" loading={join.isPending} onPress={() => join.mutate()} />
                <Txt v="small" color={T.muted}>This adds you to {p.team_name} and to this match's squad. You can withdraw from the match page.</Txt>
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <Txt v="body" color={T.muted}>Verify your mobile number to join. You'll come straight back here to add yourself.</Txt>
                <Button title="I'm new: create an account" size="lg" onPress={() => router.push({ pathname: "/login", params: { signup: "1" } })} />
                <Button title="I have an account: log in" variant="secondary" size="lg" onPress={() => router.push("/login")} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ icon: Icon, text }: { icon: typeof MapPin; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Icon size={16} color="#7FE0D6" style={{ marginTop: 2 }} />
      <Txt v="small" color="rgba(255,255,255,0.88)" style={{ flex: 1, fontSize: 14 }}>{text}</Txt>
    </View>
  );
}
