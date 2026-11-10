import { MOBILE_REGEX, normaliseMobile, OTP_REGEX, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/premium";
import { Button, Field, Muted, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DEFAULT_LOGIN } from "@/lib/config";
import { useSimCode } from "@/lib/simulator";
import { SPORTS, useSport } from "@/lib/sports";
import { SP, T } from "@/theme";

/**
 * Sign in and sign up are one flow: mobile number → 6-digit code. A new number gets a phone-verified account and
 * the app then opens registration (email, Player/Captain, name and photo; see app/register.tsx). Email + password
 * stays available for existing accounts that set one; password reset always goes through the mobile number.
 */
export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { sport } = useSport();
  const [mode, setMode] = useState<"phone" | "email">(DEFAULT_LOGIN === "email" ? "email" : "phone");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [reset, setReset] = useState<null | "phone" | "code">(null);
  const [f, setF] = useState({ mobile: "", email: "", code: "", password: "" });
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [signup, setSignup] = useState(false); // same phone flow; only the wording changes for new players
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mobile = normaliseMobile(f.mobile);

  const opts = useQuery({ queryKey: ["auth-options"], queryFn: () => api<S<"AuthOptionsOut">>("/auth/options"), staleTime: 60_000 });
  const waReady = !!opts.data?.whatsapp_otp;
  const simulator = !!opts.data?.whatsapp_simulator;
  const singleSport = !!opts.data?.beta_sport;
  const testerPrefix = opts.data?.tester_signup_prefix ?? null; // friends-testing mode (never in production)

  // Resend countdown: ticks once a second only while it is running.
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);

  const simCode = useSimCode((x) => x.code);
  const clearSim = useSimCode((x) => x.setCode);
  useEffect(() => {
    if (!simCode) return;
    clearSim(null);
    if (reset === "code") setF((p) => ({ ...p, code: simCode }));
    else if (step === "otp") { setF((p) => ({ ...p, code: simCode })); void verify(simCode); }
  }, [simCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const sent = (r: S<"OtpSentOut">) => { setDev(r.dev_otp ?? null); setResendAt(Date.now() + r.resend_after * 1000); setNow(Date.now()); };
  const validMobile = () => MOBILE_REGEX.test(f.mobile.replace(/\s/g, ""));

  const request = async (via: "sms" | "whatsapp" = "sms") => {
    setChannel(via); setErr(null); setNotice(null);
    if (!validMobile()) return setErr("Enter a valid 10-digit mobile number");
    setBusy(true);
    try {
      sent(await api<S<"OtpSentOut">>("/auth/send-otp", { method: "POST", body: { mobile_number: mobile, purpose: "login", channel: via } }));
      setF((p) => ({ ...p, code: "" }));
      setStep("otp");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  const verify = async (code = f.code) => {
    if (!OTP_REGEX.test(code)) return setErr("Enter the 6-digit code");
    setBusy(true); setErr(null);
    try {
      const t = await api<S<"TokenOut">>("/auth/verify-otp", { method: "POST", body: { mobile_number: mobile, code, purpose: "login" } });
      await signIn(t.access_token, t.refresh_token, t.user); // the root gate opens registration if it isn't finished
    } catch (e) { setErr(errorText(e)); setF((p) => ({ ...p, code: "" })); } finally { setBusy(false); }
  };

  /** Accepts typing, SMS autofill and pasted text such as "Your code is 123 456". */
  const onCode = (text: string) => {
    const code = text.replace(/\D/g, "").slice(0, 6);
    setF((p) => ({ ...p, code }));
    if (err) setErr(null);
    if (code.length === 6 && !busy) void verify(code);
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

  const sendReset = async (via: "sms" | "whatsapp" = "sms") => {
    setChannel(via); setErr(null);
    if (!validMobile()) return setErr("Enter the mobile number on your account");
    setBusy(true);
    try { sent(await api<S<"OtpSentOut">>("/auth/send-otp", { method: "POST", body: { mobile_number: mobile, purpose: "reset_password", channel: via } })); setReset("code"); }
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

  const title = reset ? "Reset password" : mode === "email" ? "Welcome back" : step === "otp" ? "Enter the code" : signup ? "Create your account" : "Log in with your mobile";
  const sub = reset ? null : mode === "email" ? "Log in with your email and password." : step === "otp" ? `Sent ${channel === "whatsapp" ? "on WhatsApp" : "by SMS"} to ${mobile}`
    : signup ? "Start with your mobile number. We'll text you a 6-digit code." : "We'll send a 6-digit code to verify it.";
  const back = step === "otp" || reset || (mode === "email" && DEFAULT_LOGIN !== "email")
    ? () => { setErr(null); if (reset) setReset(null); else if (step === "otp") setStep("phone"); else { setMode("phone"); setSignup(false); } }
    : signup && DEFAULT_LOGIN === "email" ? () => { setErr(null); setSignup(false); setMode("email"); }
    : router.canGoBack() ? () => router.back() : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: SP.page, paddingTop: insets.top + 12, gap: SP.xl }}>
          <View style={{ height: 40, justifyContent: "center" }}>
            {back ? <Button variant="ghost" size="sm" title="‹ Back" onPress={back} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} /> : null}
          </View>
          <Wordmark size={38} />
          <View style={{ gap: 6 }}>
            <Txt v="hero" accessibilityRole="header">{title}</Txt>
            {sub ? <Muted>{sub}</Muted> : null}
            {sport && step === "phone" && !reset && mode === "phone" ? (
              <Txt v="small" color={T.muted}>Playing <Txt v="smallSemi" color={T.ink}>{SPORTS[sport].name}</Txt>{singleSport ? null : <Txt v="small" color={T.muted}> · <Txt v="smallSemi" color={T.primaryDark} onPress={() => router.replace("/sport")}>Change</Txt></Txt>}</Txt>
            ) : null}
          </View>
          {notice ? <Txt v="small" color={T.successText}>{notice}</Txt> : null}

          {reset === "phone" ? (
            <View style={{ gap: 14 }}>
              <Field label="Mobile number on your account" value={f.mobile} onChangeText={(m) => setF({ ...f, mobile: m })} keyboardType="phone-pad" placeholder="98765 43210" error={err} />
              <Button title="Send reset code" size="lg" loading={busy && channel === "sms"} onPress={() => void sendReset("sms")} />
              {waReady ? <WhatsAppCodeButton loading={busy && channel === "whatsapp"} onPress={() => void sendReset("whatsapp")} /> : null}
            </View>
          ) : reset === "code" ? (
            <View style={{ gap: 14 }}>
              <CodeField value={f.code} onChange={(t) => setF({ ...f, code: t.replace(/\D/g, "").slice(0, 6) })} />
              <Field label="New password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" textContentType="newPassword" error={err} />
              {dev ? <DevCode code={dev} /> : null}
              {simulator && channel === "whatsapp" ? <SimButton phone={mobile} /> : null}
              <Button title="Set new password" size="lg" loading={busy} onPress={() => void doReset()} />
            </View>
          ) : mode === "email" ? (
            <View style={{ gap: 14 }}>
              <Field label="Email" value={f.email} onChangeText={(email) => setF({ ...f, email })} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" />
              <Field label="Password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" autoComplete="password" textContentType="password" error={err} />
              <Button title="Log in" size="lg" loading={busy} onPress={() => void emailLogin()} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Button variant="ghost" size="sm" title="Forgot password?" onPress={() => { setReset("phone"); setErr(null); setNotice(null); }} />
                <Button variant="ghost" size="sm" title="Use mobile number" onPress={() => { setMode("phone"); setSignup(false); setErr(null); }} />
              </View>
              <NewHere onPress={() => { setMode("phone"); setSignup(true); setErr(null); }} />
            </View>
          ) : step === "phone" ? (
            <View style={{ gap: 14 }}>
              <Field label="Mobile number" value={f.mobile} onChangeText={(m) => { setF({ ...f, mobile: m }); if (err) setErr(null); }} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+91  98765 43210" error={err} autoFocus />
              {testerPrefix ? (
                <Txt v="small" color={T.primaryDark}>Testing? Use {testerPrefix.replace(/^\+(\d{2})(\d{4})(\d{3})/, "+$1 $2 $3")}123 and your code shows here.</Txt>
              ) : null}
              <Button title="Send code" size="lg" loading={busy && channel === "sms"} disabled={busy} onPress={() => void request("sms")} />
              {waReady ? <WhatsAppCodeButton loading={busy && channel === "whatsapp"} onPress={() => void request("whatsapp")} /> : null}
              {signup
                ? <Button variant="ghost" size="sm" title="Already have an account? Log in" onPress={() => { setSignup(false); setMode(DEFAULT_LOGIN === "email" ? "email" : "phone"); setErr(null); }} />
                : <>
                    <Button variant="ghost" size="sm" title="Log in with email & password" onPress={() => { setMode("email"); setErr(null); }} />
                    <NewHere onPress={() => { setSignup(true); setErr(null); }} />
                  </>}
              <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>
                By continuing you agree to the GoFindr{" "}
                <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/terms")} style={{ textDecorationLine: "underline" }}>Terms of Use</Txt>
                {" "}and{" "}
                <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/privacy")} style={{ textDecorationLine: "underline" }}>Privacy Notice</Txt>
              </Txt>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <CodeField value={f.code} onChange={onCode} error={err} autoFocus />
              {dev ? <DevCode code={dev} onUse={() => onCode(dev)} /> : null}
              {simulator && channel === "whatsapp" ? <SimButton phone={mobile} /> : null}
              <Button title="Verify" size="lg" loading={busy} disabled={busy || f.code.length !== 6} onPress={() => void verify()} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Button variant="ghost" size="sm" title="Change number" onPress={() => { setStep("phone"); setErr(null); }} />
                {wait > 0
                  ? <Txt v="small" color={T.muted} accessibilityLiveRegion="polite">Resend in {wait}s</Txt>
                  : <Button variant="ghost" size="sm" title="Resend code" disabled={busy} onPress={() => void request(channel)} />}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Sign-up entry: new players register with their mobile number (the code verifies it), never by email. */
function NewHere({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="New to GoFindr? Create an account" onPress={onPress}
      style={({ pressed }) => ({ marginTop: 6, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface, alignItems: "center" })}>
      <Txt v="small" color={T.muted}>New to GoFindr? <Txt v="smallSemi" color={T.primaryDark}>Create an account</Txt></Txt>
    </Pressable>
  );
}

/** One field for the 6-digit code: iOS offers the SMS code above the keyboard, Android reads it, paste works. */
function CodeField({ value, onChange, error, autoFocus }: { value: string; onChange: (v: string) => void; error?: string | null; autoFocus?: boolean }) {
  return (
    <Field label="6-digit code" value={value} onChangeText={onChange} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp"
      autoFocus={autoFocus} error={error} style={{ fontSize: 24, letterSpacing: 10, textAlign: "center", fontFamily: "Inter_800ExtraBold" }} />
  );
}

function DevCode({ code, onUse }: { code: string; onUse?: () => void }) {
  return (
    <Text style={{ backgroundColor: T.warningBackground, color: T.warningText, padding: 12, borderRadius: 14 }}>
      Test mode: your code is <Text style={{ fontFamily: "Inter_800ExtraBold" }} onPress={onUse}>{code}</Text>
    </Text>
  );
}

function SimButton({ phone }: { phone: string }) {
  return <Button title="Open WhatsApp simulator (test mode)" variant="secondary" onPress={() => router.push({ pathname: "/whatsapp-sim", params: { phone } })} />;
}

/** "Get code on WhatsApp": shown only once a WhatsApp provider (or the simulator) is connected on the server. */
function WhatsAppCodeButton({ loading, onPress }: { loading: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ busy: loading }} accessibilityLabel="Get code on WhatsApp" disabled={loading} onPress={onPress}
      style={({ pressed }) => ({ height: 50, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: pressed ? T.successPill : T.successBackground, borderWidth: 1, borderColor: "#BFE8CF" })}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center" }}><MessageCircle size={13} color="#FFFFFF" strokeWidth={2.6} /></View>
      <Txt v="smallSemi" color="#0B6B3A" style={{ fontSize: 15 }}>{loading ? "Sending…" : "Get code on WhatsApp"}</Txt>
    </Pressable>
  );
}
