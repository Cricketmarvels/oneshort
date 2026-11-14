/**
 * Create account with email: name, date of birth, email, password (12+), playing roles → POST /auth/register/email.
 * Everything registration needs is collected here, so the account opens complete. Email stays unverified until the
 * player verifies it from Settings; the password is sent once over HTTPS and stored only as an Argon2id hash.
 */
import type { S } from "@cm/shared";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/brand";
import { GoogleButton } from "@/components/google-button";
import { DobField, type PlayingRoleId, RolesField } from "@/components/profile-fields";
import { Button, Field, Muted, Txt } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSport } from "@/lib/sports";
import { confirmError, dobError, emailError, nameError, passwordError, rolesError } from "@/lib/validation";
import { SP, T } from "@/theme";

type Errs = Partial<Record<"name" | "dob" | "email" | "password" | "confirm" | "roles" | "form", string>>;

export default function EmailSignup() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { sport } = useSport();
  const cricket = (sport ?? "cricket") === "cricket";
  const [f, setF] = useState({ name: "", dob: null as string | null, email: "", password: "", confirm: "" });
  const [roles, setRoles] = useState<PlayingRoleId[]>([]);
  const [err, setErr] = useState<Errs>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((p) => ({ ...p, [k]: v })); if (err[k as keyof Errs] || err.form) setErr((e) => ({ ...e, [k]: undefined, form: undefined })); };

  const check = (): boolean => {
    const e: Errs = {
      name: nameError(f.name) ?? undefined, dob: dobError(f.dob) ?? undefined, email: emailError(f.email) ?? undefined,
      password: passwordError(f.password) ?? undefined, confirm: confirmError(f.password, f.confirm) ?? undefined,
      roles: cricket ? rolesError(roles) ?? undefined : undefined,
    };
    setErr(e);
    return !Object.values(e).some(Boolean);
  };

  const submit = async () => {
    if (!check()) return;
    setBusy(true);
    try {
      const t = await api<S<"TokenOut">>("/auth/register/email", { method: "POST", body: {
        full_name: f.name.trim(), date_of_birth: f.dob, email: f.email.trim().toLowerCase(), password: f.password, confirm_password: f.confirm,
        playing_roles: cricket ? roles : ["batsman"], sport: sport ?? "cricket",
      } });
      await signIn(t.access_token, t.refresh_token, t.user); // the root gate takes it from here (consent, then Home)
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      if (code === "ACCOUNT_EXISTS") setErr({ email: "This email already has an account. Log in instead." });
      else setErr({ form: errorText(e) });
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: SP.page, paddingBottom: insets.bottom + SP.xl, gap: SP.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ height: 40, justifyContent: "center" }}>
          <Button variant="ghost" size="sm" title="‹ Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
        </View>
        <Wordmark size={22} />
        <View style={{ gap: 6 }}>
          <Txt v="hero" accessibilityRole="header">Create your account</Txt>
          <Muted>Takes a minute. Captains see your name and roles; your date of birth stays private.</Muted>
        </View>

        <GoogleButton onError={(t) => setErr({ form: t })} label="Continue with Google instead" />

        <View style={{ gap: 14 }}>
          <Field testID="su-name" label="Player name" value={f.name} onChangeText={(v) => set("name", v)} autoComplete="name" textContentType="name" autoCapitalize="words" error={err.name} returnKeyType="next" />
          <DobField value={f.dob} onChange={(v) => set("dob", v)} error={err.dob} />
          <Field testID="su-email" label="Email" value={f.email} onChangeText={(v) => set("email", v)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" error={err.email} returnKeyType="next" />
          <Field testID="su-password" label="Set password" value={f.password} onChangeText={(v) => set("password", v)} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword"
            hint="At least 12 characters, with a letter and a number." error={err.password} />
          <Field testID="su-confirm" label="Confirm password" value={f.confirm} onChangeText={(v) => set("confirm", v)} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={err.confirm} />
          {cricket ? <RolesField value={roles} onChange={(v) => { setRoles(v); if (err.roles) setErr((e) => ({ ...e, roles: undefined })); }} error={err.roles} /> : null}
        </View>

        {err.form ? <Txt v="small" color={T.dangerText} accessibilityRole="alert">{err.form}</Txt> : null}
        <Button testID="su-submit" title="Create account" size="lg" loading={busy} disabled={busy} onPress={() => void submit()} />
        <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>
          By continuing you agree to the OneShort{" "}
          <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/terms")} style={{ textDecorationLine: "underline" }}>Terms of Use</Txt>
          {" "}and{" "}
          <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/privacy")} style={{ textDecorationLine: "underline" }}>Privacy Notice</Txt>
        </Txt>
        <Txt v="small" color={T.muted} style={{ textAlign: "center" }} onPress={() => router.replace("/login")}>Already have an account? <Txt v="smallSemi" color={T.primaryDark}>Log in</Txt></Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
