/**
 * Progressive onboarding (refined spec §5.3), shown once after sign-up:
 *   1 · How will you play? Player / Captain / Both (a preference on ONE account)
 *   2 · Name and area (manual area always available; no location permission needed)
 *   3 · Sport profile: main role + usual days/times (optional — can skip)
 */
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KickerChip } from "@/components/refined";
import { ChoiceRow, H } from "@/components/starter";
import { Button, Chip, Field, InlineNotice, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHomeContext } from "@/lib/context";
import { PLACES, useLocation } from "@/lib/location";
import { useOnboarding } from "@/lib/onboarding";
import { SP, T } from "@/theme";

type PlayAs = "player" | "captain" | "both";
const ROLES = [["batsman", "Batter"], ["bowler", "Bowler"], ["all_rounder", "All-rounder"], ["wicketkeeper", "Wicketkeeper"]] as const;
const DAYS = [["sat", "Sat"], ["sun", "Sun"], ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"]] as const;
const TIMES = [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["night", "Night"]] as const;

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { user, reload } = useAuth();
  const ctx = useHomeContext();
  const loc = useLocation();
  const done = useOnboarding((s) => s.finish);
  const [step, setStep] = useState(1);
  const [playAs, setPlayAs] = useState<PlayAs>("player");
  const [name, setName] = useState(user?.full_name ?? "");
  const [area, setArea] = useState(PLACES.find((p) => p.label === loc.label) ?? null);
  const [role, setRole] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>(["sat", "sun"]);
  const [times, setTimes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const finish = () => { done(); router.replace(playAs !== "player" ? "/teams" : "/"); };
  const saveName = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter your name");
      await api("/users/me", { method: "PUT", body: { full_name: name.trim(), ...(area ? { city: area.city } : {}) } });
      if (area) loc.pick(area);
      await reload();
    },
    onSuccess: () => { setErr(null); setStep(3); },
    onError: (e) => setErr(e instanceof Error && !("status" in e) ? e.message : errorText(e)),
  });
  const saveProfile = useMutation({
    mutationFn: () => api("/players/me", { method: "PUT", body: {
      primary_role: role, preferred_days: days, preferred_timing: times,
      ...(area ? { locality: area.label.split(",")[0], home_location: { lat: area.lat, lng: area.lng } } : {}),
    } }),
    onSuccess: finish,
    onError: (e) => setErr(errorText(e)),
  });
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: SP.page, paddingBottom: 140, gap: SP.xl }} keyboardShouldPersistTaps="handled">
        {step > 1 ? <H title={step === 2 ? "About you" : "How you play"} sub="A few details so nearby players and teams can find you." /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <KickerChip label={`STEP ${step} OF 3`} />
          <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>{[1, 2, 3].map((i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? T.primary : T.line }} />)}</View>
        </View>

        {step === 1 ? (
          <View style={{ gap: 12 }} accessibilityRole="radiogroup">
            <H title="Your Role" sub="How do you want to use PlayR?" />
            <ChoiceRow lead={<Txt style={{ fontSize: 35, lineHeight: 42 }}>🏃</Txt>} title="Player" body="Find games, join teams and play regularly" selected={playAs === "player"} onPress={() => setPlayAs("player")} />
            <ChoiceRow lead={<Txt style={{ fontSize: 35, lineHeight: 42 }}>🏆</Txt>} title="Captain" body="Create teams, manage squads and organise matches" selected={playAs === "captain"} onPress={() => setPlayAs("captain")} />
            <ChoiceRow lead={<Txt style={{ fontSize: 35, lineHeight: 42 }}>🤝</Txt>} title="Both" body="Play for others and run your own team" selected={playAs === "both"} onPress={() => setPlayAs("both")} />
            <Txt v="small" color={T.muted}>One account either way — switch between Player and Captain on Home.</Txt>
          </View>
        ) : step === 2 ? (
          <View style={{ gap: 14 }}>
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" />
            <View style={{ gap: 8 }}>
              <Txt v="label">Your area</Txt>
              <Txt v="small" color={T.muted}>Used to show players and games near you. Only the area name is public — never your exact location.</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {PLACES.map((p) => <Chip key={p.label} label={p.label} active={area?.label === p.label} onPress={() => setArea(p)} />)}
              </View>
            </View>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={{ gap: 8 }}>
              <Txt v="h2">Your main role</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{ROLES.map(([v, l]) => <Chip key={v} label={l} active={role === v} onPress={() => setRole(v)} />)}</View>
            </View>
            <View style={{ gap: 8 }}>
              <Txt v="h2">When do you usually play?</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{DAYS.map(([v, l]) => <Chip key={v} label={l} active={days.includes(v)} onPress={() => toggle(days, v, setDays)} />)}</View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TIMES.map(([v, l]) => <Chip key={v} label={l} active={times.includes(v)} onPress={() => toggle(times, v, setTimes)} />)}</View>
              <Txt v="small" color={T.muted}>Captains only find you for matches when you add availability slots — you can do that next from your profile.</Txt>
            </View>
          </View>
        )}
        {err ? <InlineNotice tone="warning">{err}</InlineNotice> : null}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: SP.page, paddingBottom: Math.max(insets.bottom, 20), backgroundColor: T.bg, gap: 6 }}>
        {step === 1 ? (
          <Button title="Continue" size="lg" onPress={() => { ctx.set(playAs === "player" ? "player" : "captain"); setStep(2); }} />
        ) : step === 2 ? (
          <Button title="Continue" size="lg" loading={saveName.isPending} onPress={() => saveName.mutate()} />
        ) : (
          <>
            <Button title={playAs === "player" ? "Finish" : "Finish & create your team"} size="lg" disabled={!role} loading={saveProfile.isPending} onPress={() => saveProfile.mutate()} />
            <Button title="Skip for now" variant="ghost" onPress={finish} />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
