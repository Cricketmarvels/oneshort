/**
 * Registration, opened by the root gate for a phone-verified account whose sign-up isn't finished
 * (`registration_completed_at` is null). Three short steps, one primary action each:
 *   1 · Email (collected, not verified in this release)
 *   2 · Player or Captain
 *   3 · Name, main role (cricket) and profile photo → POST /users/me/registration
 *       (test numbers also set a password here, so an interruption can't lose it: it is never stored)
 * Progress is kept on the device (lib/registration.ts), so closing the app resumes on the same step.
 */
import type { S } from "@cm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlayRIcon } from "@/components/icons";
import { CameraBadge } from "@/components/premium";
import { KickerChip } from "@/components/refined";
import { ChoiceRow, H } from "@/components/starter";
import { Avatar, Button, Chip, Field, Txt } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOnboarding } from "@/lib/onboarding";
import { useProfilePhoto } from "@/lib/profile-photo";
import { useRegistration } from "@/lib/registration";
import { useSport } from "@/lib/sports";
import { SP, T } from "@/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES = [["batsman", "Batter"], ["bowler", "Bowler"], ["all_rounder", "All-rounder"], ["wicketkeeper", "Wicketkeeper"]] as const;
const PLACEHOLDER = "GoFindr player";

export default function Register() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, reload, signOut } = useAuth();
  const { sport } = useSport();
  const reg = useRegistration();
  const finishOnboarding = useOnboarding((s) => s.finish);
  const photo = useProfilePhoto();
  const opts = useQuery({ queryKey: ["auth-options"], queryFn: () => api<S<"AuthOptionsOut">>("/auth/options"), staleTime: 60_000 });
  const prefix = opts.data?.tester_signup_prefix;
  const tester = !!(prefix && user?.mobile_number?.startsWith(prefix) && !user.has_password);
  const [password, setPassword] = useState(""); // test mode only, never stored in the draft
  const [err, setErr] = useState<{ field: "email" | "name" | "password" | "form"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) void reg.load(user.id); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // prefill once from the account (e.g. a name kept from an invite link)
    if (user && reg.userId === user.id && !reg.draft.name && user.full_name !== PLACEHOLDER) reg.update({ name: user.full_name });
  }, [reg.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || reg.userId !== user.id) return <View style={{ flex: 1, backgroundColor: T.bg }} />;
  const { step, email, playAs, name, role } = reg.draft;
  const cricket = (sport ?? user.preferred_sport) === "cricket";

  const next = () => {
    setErr(null);
    if (step === 1) {
      if (!EMAIL_RE.test(email.trim())) return setErr({ field: "email", text: "Enter a valid email address" });
      return reg.update({ step: 2, email: email.trim() });
    }
    if (step === 2) return reg.update({ step: 3 });
    void submit();
  };

  const submit = async () => {
    if (name.trim().length < 2) return setErr({ field: "name", text: "Enter your name" });
    if (tester && password.length < 8) return setErr({ field: "password", text: "Use at least 8 characters" });
    setBusy(true);
    try {
      await api("/users/me/registration", { method: "POST", body: {
        full_name: name.trim(), email: email.trim(), play_as: playAs,
        ...(sport ? { sport } : {}),
        ...(cricket && role ? { primary_role: role } : {}),
        ...(tester && password ? { password } : {}),
      } });
      finishOnboarding(user.id); // the older onboarding screens are covered by this flow
      reg.clear();
      qc.clear();
      await reload();
      router.replace(playAs === "captain" ? "/teams" : "/");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      if (code === "EMAIL_IN_USE") { reg.update({ step: 1 }); setErr({ field: "email", text: "This email is already used by another account" }); }
      else if (code === "PASSWORD_REQUIRED") setErr({ field: "password", text: errorText(e) });
      else if (code === "REGISTRATION_COMPLETE") { await reload(); router.replace("/"); }
      else setErr({ field: "form", text: errorText(e) });
    } finally { setBusy(false); }
  };

  const back = () => { setErr(null); if (step > 1) reg.update({ step: (step - 1) as 1 | 2 }); else void signOut(); };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: SP.page, paddingBottom: insets.bottom + SP.xl, gap: SP.xl, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 40 }}>
          <Button variant="ghost" size="sm" title={step > 1 ? "‹ Back" : "‹ Use another number"} onPress={back} style={{ paddingHorizontal: 0 }} />
          <View style={{ flex: 1 }} />
          <KickerChip label={`STEP ${step} OF 3`} />
        </View>
        <View style={{ flexDirection: "row", gap: 4 }}>{[1, 2, 3].map((i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? T.primary : T.line }} />)}</View>

        {step === 1 ? (
          <View style={{ gap: 16 }}>
            <H title="Your email" sub="For match updates and receipts. No verification needed right now." />
            <Field label="Email" value={email} onChangeText={(v) => { reg.update({ email: v }); if (err) setErr(null); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" autoFocus error={err?.field === "email" ? err.text : null} returnKeyType="next" onSubmitEditing={next} />
          </View>
        ) : step === 2 ? (
          <View style={{ gap: 12 }} accessibilityRole="radiogroup">
            <H title="How will you use GoFindr?" sub="You can do both later from Home." />
            <ChoiceRow lead={<RoleIcon name="cricket" />} title="Player" body="Find matches and teams near you" selected={playAs === "player"} onPress={() => reg.update({ playAs: "player" })} />
            <ChoiceRow lead={<RoleIcon name="shield" />} title="Captain" body="Run a team, find players and opponents" selected={playAs === "captain"} onPress={() => reg.update({ playAs: "captain" })} />
          </View>
        ) : (
          <View style={{ gap: 18 }}>
            <H title="Your profile" sub="This is what captains and players see." />
            <View style={{ alignItems: "center", gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={user.profile_image ? "Change profile photo" : "Add profile photo"} disabled={photo.busy} onPress={() => void photo.upload("library")}>
                <Avatar uri={user.profile_image} name={name.trim() || "?"} size={96} />
                <CameraBadge size={30} />
              </Pressable>
              <Txt v="small" color={T.primaryDark}>{photo.busy ? "Uploading…" : user.profile_image ? "Tap to change" : "Add a photo (optional)"}</Txt>
            </View>
            <Field label="Full name" value={name} onChangeText={(v) => { reg.update({ name: v }); if (err) setErr(null); }} autoComplete="name" textContentType="name" autoCapitalize="words" error={err?.field === "name" ? err.text : null} />
            {tester ? (
              <Field label="Password (test mode)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" textContentType="newPassword"
                hint="Test numbers only get a code once, so you'll log back in with email and this password." error={err?.field === "password" ? err.text : null} />
            ) : null}
            {cricket ? (
              <View style={{ gap: 8 }}>
                <Txt v="label">Main role (optional)</Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {ROLES.map(([v, l]) => <Chip key={v} label={l} active={role === v} onPress={() => reg.update({ role: role === v ? null : v })} />)}
                </View>
              </View>
            ) : null}
          </View>
        )}

        <View style={{ flex: 1 }} />
        {err?.field === "form" ? <Txt v="small" color={T.dangerText}>{err.text}</Txt> : null}
        <Button title={step === 3 ? "Finish" : "Continue"} size="lg" loading={busy} disabled={busy || photo.busy} onPress={next} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RoleIcon({ name }: { name: "cricket" | "shield" }) {
  return <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}><PlayRIcon name={name} size={26} /></View>;
}
