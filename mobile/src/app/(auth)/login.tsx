import { DEFAULT_CITY, MOBILE_REGEX, normaliseMobile, OTP_REGEX, type S } from "@cm/shared";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, Muted, Txt } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DEFAULT_LOGIN } from "@/lib/config";
import { useOnboarding } from "@/lib/onboarding";
import { useSimCode } from "@/lib/simulator";
import { SPORTS, useSport } from "@/lib/sports";
import { SP, T } from "@/theme";

/** Minimal log in / sign up (no logo, no imagery): mobile OTP or email + password, forgot password via OTP. The sport chosen before login stays attached. */
export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"login" | "register" | "email">(DEFAULT_LOGIN === "email" ? "email" : "login");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [f, setF] = useState({ mobile: "", name: "", email: "", city: DEFAULT_CITY, code: "", password: "" });
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mobile = normaliseMobile(f.mobile);
  const { sport } = useSport();
  const [reset, setReset] = useState<null | "phone" | "code">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const startOnboarding = useOnboarding((x) => x.start);

  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const opts = useQuery({ queryKey: ["auth-options"], queryFn: () => api<S<"AuthOptionsOut">>("/auth/options"), staleTime: 60_000 });
  const waReady = !!opts.data?.whatsapp_otp;
  const simulator = !!opts.data?.whatsapp_simulator;
  const singleSport = !!opts.data?.beta_sport;
  const testerPrefix = opts.data?.tester_signup_prefix ?? null; // friends-testing mode (never in production)
  const simCode = useSimCode((x) => x.code);
  const clearSim = useSimCode((x) => x.setCode);
  useEffect(() => {
    if (!simCode) return;
    clearSim(null);
    if (reset === "code") setF((p) => ({ ...p, code: simCode }));
    else if (step === "otp") { setF((p) => ({ ...p, code: simCode })); void verify(simCode); }
  }, [simCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const request = async (via: "sms" | "whatsapp" = "sms") => {
    setChannel(via);
    setErrCode(null);
    setErr(null);
    if (!MOBILE_REGEX.test(f.mobile.replace(/\s/g, ""))) return setErr("Enter a valid 10-digit mobile number");
    setBusy(true);
    try {
      if (mode === "register") {
        const r = await api<S<"RegisterOut">>("/auth/register", { method: "POST", body: { full_name: f.name, mobile_number: mobile, email: f.email, city: f.city, otp_channel: via, ...(f.password ? { password: f.password } : {}) } });
        setDev(r.otp.dev_otp ?? null);
      } else {
        const r = await api<S<"OtpSentOut">>("/auth/send-otp", { method: "POST", body: { mobile_number: mobile, purpose: "login", channel: via } });
        setDev(r.dev_otp ?? null);
      }
      setStep("otp");
    } catch (e) { setErr(errorText(e)); setErrCode(e instanceof ApiError ? e.code : null); } finally { setBusy(false); }
  };
  const emailLogin = async () => {
    setErr(null);
    if (!f.email.includes("@") || !f.password) return setErr("Enter your email and password");
    setBusy(true);
    try {
      const t = await api<S<"TokenOut">>("/auth/login", { method: "POST", body: { email: f.email.trim(), password: f.password } });
      await signIn(t.access_token, t.refresh_token, t.user);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const verify = async (code = f.code) => {
    if (!OTP_REGEX.test(code)) return setErr("Enter the 6-digit code");
    setBusy(true); setErr(null);
    try {
      // Sign-up details travel WITH the code, so only the person holding the phone decides them.
      const profile = mode === "register" ? { full_name: f.name, city: f.city || undefined, ...(f.email ? { email: f.email } : {}), ...(f.password ? { password: f.password } : {}) } : undefined;
      const t = await api<S<"TokenOut">>("/auth/verify-otp", { method: "POST", body: { mobile_number: mobile, code, purpose: mode === "register" ? "register" : "login", ...(profile ? { profile } : {}) } });
      if (t.is_new_user) startOnboarding(); // new account, whether it started on Sign up or Log in
      await signIn(t.access_token, t.refresh_token, t.user);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  const sendReset = async (via: "sms" | "whatsapp" = "sms") => {
    setChannel(via);
    setErr(null);
    if (!MOBILE_REGEX.test(f.mobile.replace(/\s/g, ""))) return setErr("Enter the mobile number on your account");
    setBusy(true);
    try { const r = await api<S<"OtpSentOut">>("/auth/send-otp", { method: "POST", body: { mobile_number: mobile, purpose: "reset_password", channel: via } }); setDev(r.dev_otp ?? null); setReset("code"); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const doReset = async () => {
    setErr(null);
    if (!OTP_REGEX.test(f.code)) return setErr("Enter the 6-digit code");
    if (f.password.length < 8) return setErr("Use at least 8 characters");
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { mobile_number: mobile, code: f.code, new_password: f.password } });
      setReset(null); setMode("email"); setF({ ...f, code: "", password: "" }); setNotice("Password updated. Log in with your new password.");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const title = reset ? "Reset password" : step === "otp" ? "Verify your number" : mode === "register" ? "Create your account" : mode === "email" ? "Welcome back" : "Log in";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ gap: SP.lg, flexGrow: 1, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: SP.page, paddingTop: insets.top + 28, gap: SP.xl }}>
          {mode === "login" && step === "phone" && !reset ? (
            <View style={{ gap: 6 }}>
              <Txt v="hero" accessibilityRole="header">Find your people. Play more.</Txt>
              {sport ? (
                <Txt v="small" color={T.muted}>Selected sport: <Txt v="smallSemi" color={T.ink}>{SPORTS[sport].name}</Txt>{singleSport ? null : <Txt v="small" color={T.muted}> · <Txt v="smallSemi" color={T.primary} onPress={() => router.replace("/sport")}>Change</Txt></Txt>}</Txt>
              ) : null}
            </View>
          ) : null}
          <View style={{ gap: 6, display: mode === "login" && step === "phone" && !reset ? "none" : "flex" }}>
            <Txt v="hero" accessibilityRole="header">{title}</Txt>
            {sport ? (
              <Pressable accessibilityRole="button" accessibilityLabel={singleSport ? `Playing ${SPORTS[sport].name}` : `Playing ${SPORTS[sport].name}. Change sport`} disabled={singleSport} onPress={() => router.replace("/sport")} hitSlop={8} style={{ alignSelf: "flex-start" }}>
                <Txt v="body" color={T.muted}>Playing <Txt v="bodyMed" color={T.ink}>{SPORTS[sport].name}</Txt>{singleSport ? null : <Txt v="body" color={T.muted}> · <Txt v="smallSemi" color={T.primaryDark}>Change</Txt></Txt>}</Txt>
              </Pressable>
            ) : null}
            {step === "otp" && !reset ? <Muted>Code sent {channel === "whatsapp" ? "on WhatsApp" : "by SMS"} to {mobile}</Muted> : null}
            {simulator && channel === "whatsapp" && (step === "otp" || reset === "code") ? (
              <Button title="Open WhatsApp simulator (test mode)" variant="secondary" onPress={() => router.push({ pathname: "/whatsapp-sim", params: { phone: mobile } })} />
            ) : null}
          </View>
          {notice ? <Txt v="small" color={T.successText}>{notice}</Txt> : null}
          {reset === "phone" ? (
            <View style={{ gap: 14 }}>
              <Field label="Mobile number on your account" value={f.mobile} onChangeText={(m) => setF({ ...f, mobile: m })} keyboardType="phone-pad" placeholder="98765 43210" error={err} />
              <Button title="Send reset code by SMS" loading={busy && channel === "sms"} onPress={() => void sendReset("sms")} />
              <WhatsAppCodeButton ready={waReady} loading={busy && channel === "whatsapp"} onPress={() => void sendReset("whatsapp")} />
              <Button variant="ghost" title="Back to log in" onPress={() => { setReset(null); setErr(null); }} />
            </View>
          ) : reset === "code" ? (
            <View style={{ gap: 14 }}>
              <Field label="One-time password" value={f.code} onChangeText={(code) => setF({ ...f, code })} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp" />
              <Field label="New password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" textContentType="newPassword" error={err} />
              {dev ? <Text style={{ backgroundColor: T.warningBackground, color: T.warningText, padding: 12, borderRadius: 14 }}>Development mode: your code is {dev}</Text> : null}
              <Button title="Set new password" loading={busy} onPress={() => void doReset()} />
              <Button variant="ghost" title="Back to log in" onPress={() => { setReset(null); setErr(null); }} />
            </View>
          ) : mode === "email" ? (
            <View style={{ gap: 14, marginTop: 4 }}>
              <Field label="Email" value={f.email} onChangeText={(email) => setF({ ...f, email })} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" />
              <Field label="Password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" autoComplete="password" textContentType="password" error={err} />
              <View style={{ alignSelf: "flex-end", marginTop: -6 }}><Button variant="ghost" size="sm" title="Forgot password?" onPress={() => { setReset("phone"); setErr(null); setNotice(null); }} /></View>
              <Button title="Log in" loading={busy} onPress={() => void emailLogin()} />
              <Button variant="ghost" title="Use mobile OTP instead" onPress={() => { setMode("login"); setErr(null); }} />
              <Button variant="ghost" title="New here? Sign up" onPress={() => { setMode("register"); setErr(null); }} />
            </View>
          ) : step === "phone" ? (
            <View style={{ gap: 14, marginTop: 4 }}>
              {mode === "register" && <>
                <Field label="Full name" value={f.name} onChangeText={(name) => setF({ ...f, name })} autoComplete="name" />
                <Field label="Email" value={f.email} onChangeText={(email) => setF({ ...f, email })} keyboardType="email-address" autoCapitalize="none" />
                <Field label="City" value={f.city} onChangeText={(city) => setF({ ...f, city })} />
                <Field label="Password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword"
                  hint={testerPrefix ? "Needed to log back in with your email" : "Optional · lets you also log in with email"} />
                {testerPrefix ? (
                  <View style={{ padding: 12, borderRadius: 14, backgroundColor: T.primarySoft, gap: 2 }}>
                    <Txt v="smallSemi" color={T.primaryDark}>Testing GoFindr?</Txt>
                    <Txt v="small" color={T.primaryDark}>Use a test number like {testerPrefix.replace(/^\+(\d{2})(\d{4})(\d{3})/, "+$1 $2 $3")}123. Your code shows on screen.</Txt>
                  </View>
                ) : null}
              </>}
              <Field label="Mobile number" value={f.mobile} onChangeText={(m) => setF({ ...f, mobile: m })} keyboardType="phone-pad" placeholder="+91  98765 43210" hint={mode === "login" ? "Indian mobile number (+91)" : undefined} error={err} />
              <Button title="Continue with OTP" size="lg" loading={busy && channel === "sms"} onPress={() => void request("sms")} />
              <WhatsAppCodeButton ready={waReady} loading={busy && channel === "whatsapp"} onPress={() => void request("whatsapp")} />
              <Button variant="ghost" title={mode === "login" ? "New here? Create an account" : "Have an account? Log in"} onPress={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }} />
              {mode === "login" && <Button variant="ghost" title="Log in with email & password" onPress={() => { setMode("email"); setErr(null); }} />}
              <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>
                By continuing you agree to the GoFindr{" "}
                <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/terms")} style={{ textDecorationLine: "underline" }}>Terms of Use</Txt>
                {" "}and{" "}
                <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/privacy")} style={{ textDecorationLine: "underline" }}>Privacy Notice</Txt>
              </Txt>
            </View>
          ) : (
            <View style={{ gap: 14, marginTop: 4 }}>
              <Field label="6-digit code" value={f.code} onChangeText={(code) => { setF({ ...f, code }); if (code.length === 6) void verify(code); }} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp" error={err} style={{ fontSize: 22, letterSpacing: 8, textAlign: "center", fontFamily: "Inter_800ExtraBold" }} />
              {dev && <Text style={{ backgroundColor: T.warningBackground, color: T.warningText, padding: 12, borderRadius: 14 }}>Development mode: your code is <Text style={{ fontFamily: "Inter_800ExtraBold" }} onPress={() => { setF({ ...f, code: dev }); void verify(dev); }}>{dev}</Text></Text>}
              <Button title="Continue" size="lg" loading={busy} onPress={() => void verify()} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Button variant="ghost" title="Change number" onPress={() => setStep("phone")} />
                <Button variant="ghost" title="Resend code" loading={busy} onPress={() => void request(channel)} />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** "Get code on WhatsApp": active once a WhatsApp provider is connected on the server; explains itself until then. */
function WhatsAppCodeButton({ ready, loading, onPress }: { ready: boolean; loading: boolean; onPress: () => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready, busy: loading }} accessibilityLabel="Get code on WhatsApp" disabled={!ready || loading} onPress={onPress}
        style={({ pressed }) => ({ height: 50, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: pressed ? T.successPill : T.successBackground, borderWidth: 1, borderColor: "#BFE8CF", opacity: ready ? 1 : 0.55 })}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center" }}><MessageCircle size={13} color="#FFFFFF" strokeWidth={2.6} /></View>
        <Txt v="smallSemi" color="#0B6B3A" style={{ fontSize: 15 }}>{loading ? "Sending…" : "Get code on WhatsApp"}</Txt>
      </Pressable>
      {!ready ? <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>WhatsApp codes aren't connected yet — use SMS for now.</Txt> : null}
    </View>
  );
}
