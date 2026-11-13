import { MOBILE_REGEX, normaliseMobile, OTP_REGEX, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Sign in and sign up are one flow: mobile number → 6-digit SMS code. Nothing else is asked before the number is
 * proven. A new number gets a phone-verified account and the app then opens registration (name and email,
 * Player/Captain, profile; see app/register.tsx). Email + password stays available for existing accounts that set
 * one; password reset always goes through the mobile number. The email-code sign-up form (name, email, mobile,
 * password) only appears when the deferred EMAIL_OTP_ENABLED switch is on.
 */
export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { sport } = useSport();
  const startSignup = useLocalSearchParams<{ signup?: string }>().signup === "1"; // e.g. from an invite link
  const [mode, setMode] = useState<"phone" | "email">(startSignup || DEFAULT_LOGIN !== "email" ? "phone" : "email");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [reset, setReset] = useState<null | "phone" | "code">(null);
  const [f, setF] = useState({ name: "", mobile: "", email: "", code: "", password: "", confirm: "" });
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"sms" | "whatsapp" | "email">("sms");
  const [signup, setSignup] = useState(startSignup); // same phone flow; only the wording changes for new players
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mobile = normaliseMobile(f.mobile);

  const opts = useQuery({ queryKey: ["auth-options"], queryFn: () => api<S<"AuthOptionsOut">>("/auth/options"), staleTime: 60_000 });
  const waReady = !!opts.data?.whatsapp_otp;
  const simulator = !!opts.data?.whatsapp_simulator;
  const singleSport = !!opts.data?.beta_sport;
  const testerPrefix = opts.data?.tester_signup_prefix ?? null; // friends-testing mode (never in production)
  const emailCodes = !!opts.data?.email_otp; // sign-up and password reset codes by email
  const emailTest = !!opts.data?.email_test_mode; // no email account connected: nothing is actually sent

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

  const [fieldErr, setFieldErr] = useState<Partial<Record<"name" | "email" | "password" | "confirm", string>>>({});
  const checkSignup = () => {
    const e: typeof fieldErr = {};
    if (f.name.trim().length < 2) e.name = "Enter your full name";
    if (!EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address";
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = "At least 8 characters, with a letter and a number";
    if (!f.confirm) e.confirm = "Enter your password again";
    else if (f.confirm !== f.password) e.confirm = "Passwords don't match";
    setFieldErr(e);
    return Object.keys(e).length === 0;
  };

  const request = async (via: "sms" | "whatsapp" = "sms") => {
    setChannel(via); setErr(null); setNotice(null);
    if (signup && emailCodes && !checkSignup()) return;
    if (!validMobile()) return setErr("Enter a valid 10-digit mobile number");
    setBusy(true);
    try {
      // Sign-up sends the details with the request; the account is only created when the code is verified.
      if (signup && emailCodes) {
        setChannel("email"); // the code goes to the email; the mobile number is verified later by SMS
        sent(await api<S<"OtpSentOut">>("/auth/email-signup/start", { method: "POST", body: signupBody() }));
      } else {
        // New and returning numbers get the same request and the same reply; the code decides which account opens.
        sent(await api<S<"OtpSentOut">>("/auth/send-otp", { method: "POST", body: { mobile_number: mobile, purpose: signup ? "register" : "login", channel: via } }));
      }
      setF((p) => ({ ...p, code: "" }));
      setStep("otp");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  const signupBody = () => ({ full_name: f.name.trim(), email: f.email.trim(), mobile_number: mobile, password: f.password });
  const verify = async (code = f.code) => {
    if (!OTP_REGEX.test(code)) return setErr("Enter the 6-digit code");
    setBusy(true); setErr(null);
    try {
      if (signup && channel === "email") {
        const t = await api<S<"TokenOut">>("/auth/email-signup/verify", { method: "POST", body: { ...signupBody(), code } });
        await signIn(t.access_token, t.refresh_token, t.user);
        return;
      }
      // Name and email are asked after this, on the registration screen, by the person who proved the number.
      const t = await api<S<"TokenOut">>("/auth/verify-otp", { method: "POST", body: { mobile_number: mobile, code, purpose: signup ? "register" : "login" } });
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

  const resetByEmail = emailCodes && f.mobile.includes("@"); // email reset only while email codes are switched on
  const sendReset = async (via: "sms" | "whatsapp" = "sms") => {
    setChannel(resetByEmail ? "email" : via); setErr(null);
    if (resetByEmail ? !EMAIL_RE.test(f.mobile.trim()) : !validMobile()) return setErr(emailCodes ? "Enter the mobile number or email on your account" : "Enter the mobile number on your account");
    setBusy(true);
    try {
      sent(resetByEmail
        ? await api<S<"OtpSentOut">>("/auth/email-reset/start", { method: "POST", body: { email: f.mobile.trim() } })
        : await api<S<"OtpSentOut">>("/auth/send-otp", { method: "POST", body: { mobile_number: mobile, purpose: "reset_password", channel: via } }));
      setReset("code");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const doReset = async () => {
    setErr(null);
    if (!OTP_REGEX.test(f.code)) return setErr("Enter the 6-digit code");
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) return setErr("At least 8 characters, with a letter and a number");
    if (f.confirm !== f.password) return setErr("Passwords don't match");
    setBusy(true);
    try {
      if (resetByEmail) await api("/auth/email-reset/verify", { method: "POST", body: { email: f.mobile.trim(), code: f.code, new_password: f.password } });
      else await api("/auth/reset-password", { method: "POST", body: { mobile_number: mobile, code: f.code, new_password: f.password } });
      setReset(null); setMode("email"); setF({ ...f, code: "", password: "", confirm: "" }); setNotice("Password updated. Log in with your new password.");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  const title = reset ? "Reset password" : mode === "email" ? "Welcome back" : step === "otp" ? "Enter the code" : signup ? "Create your account" : "Log in with your mobile";
  const sentTo = channel === "email" && emailTest && !dev ? "Email delivery isn't switched on yet." : channel === "email" ? `Sent to ${(resetByEmail && reset ? f.mobile : f.email).trim()}. Check your inbox and spam folder.` : `Sent ${channel === "whatsapp" ? "on WhatsApp" : "by SMS"} to ${mobile}`;
  const sub = reset === "code" ? sentTo : reset ? null : mode === "email" ? "Log in with your email and password." : step === "otp" ? sentTo
    : signup ? (emailCodes ? "We'll email you a 6-digit code to confirm it's you." : "We'll text a 6-digit code to verify your number.") : "We'll send a 6-digit code to verify it.";
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
              <Field label={emailCodes ? "Mobile number or email on your account" : "Mobile number on your account"} value={f.mobile} onChangeText={(m) => setF({ ...f, mobile: m })}
                keyboardType={emailCodes ? "email-address" : "phone-pad"} autoCapitalize="none" autoCorrect={false} placeholder={emailCodes ? "98765 43210 or you@example.com" : "98765 43210"} error={err} />
              <Button title="Send reset code" size="lg" loading={busy && channel !== "whatsapp"} onPress={() => void sendReset("sms")} />
              {waReady && !resetByEmail ? <WhatsAppCodeButton loading={busy && channel === "whatsapp"} onPress={() => void sendReset("whatsapp")} /> : null}
            </View>
          ) : reset === "code" ? (
            <View style={{ gap: 14 }}>
              <CodeField value={f.code} onChange={(t) => setF({ ...f, code: t.replace(/\D/g, "").slice(0, 6) })} />
              <Field label="New password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" textContentType="newPassword" hint="At least 8 characters, with a letter and a number" />
              <Field label="Confirm new password" value={f.confirm} onChangeText={(confirm) => setF({ ...f, confirm })} secureTextEntry autoCapitalize="none" textContentType="newPassword" error={err} />
              {dev ? <DevCode code={dev} /> : null}
              {simulator && channel === "whatsapp" ? <SimButton phone={mobile} /> : null}
              <Button title="Set new password" size="lg" loading={busy} onPress={() => void doReset()} />
            </View>
          ) : mode === "email" ? (
            <View style={{ gap: 14 }}>
              <Field testID="login-email" label="Email" value={f.email} onChangeText={(email) => setF({ ...f, email })} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" />
              <Field testID="login-password" label="Password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry autoCapitalize="none" autoComplete="password" textContentType="password" error={err} />
              <Button testID="login-submit" title="Log in" size="lg" loading={busy} onPress={() => void emailLogin()} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Button variant="ghost" size="sm" title="Forgot password?" onPress={() => { setReset("phone"); setErr(null); setNotice(null); }} />
                <Button testID="login-use-mobile" variant="ghost" size="sm" title="Use mobile number" onPress={() => { setMode("phone"); setSignup(false); setErr(null); }} />
              </View>
              <NewHere onPress={() => { setMode("phone"); setSignup(true); setErr(null); }} />
            </View>
          ) : step === "phone" ? (
            <View style={{ gap: 14 }}>
              {signup && emailCodes ? <>
                <Field label="Full name" value={f.name} onChangeText={(name) => { setF({ ...f, name }); setFieldErr({ ...fieldErr, name: undefined }); }} autoComplete="name" textContentType="name" autoCapitalize="words" autoFocus error={fieldErr.name} />
                <Field label="Email" value={f.email} onChangeText={(email) => { setF({ ...f, email }); setFieldErr({ ...fieldErr, email: undefined }); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" error={fieldErr.email} />
              </> : null}
              <Field testID="login-mobile" label="Mobile number" value={f.mobile} onChangeText={(m) => { setF({ ...f, mobile: m }); if (err) setErr(null); }} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+91  98765 43210" error={err} autoFocus={!signup} />
              {signup && emailCodes ? (
                <Field label="Set password" value={f.password} onChangeText={(password) => { setF({ ...f, password }); setFieldErr({ ...fieldErr, password: undefined }); }} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword"
                  hint="At least 8 characters, with a letter and a number." error={fieldErr.password} />
              ) : null}
              {signup && emailCodes ? (
                <Field label="Confirm password" value={f.confirm} onChangeText={(confirm) => { setF({ ...f, confirm }); setFieldErr({ ...fieldErr, confirm: undefined }); }} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword"
                  error={fieldErr.confirm} />
              ) : null}
              {signup && emailCodes && emailTest ? <EmailOffNotice prefix={testerPrefix} /> : null}
              {testerPrefix ? (
                <Txt v="small" color={T.primaryDark}>Testing? Use {testerPrefix.replace(/^\+(\d{2})(\d{4})(\d{3})/, "+$1 $2 $3")}123 and your code shows here.</Txt>
              ) : null}
              <Button testID="login-send-code" title={signup ? "Continue" : "Send code"} size="lg" loading={busy && channel === "sms"} disabled={busy} onPress={() => void request("sms")} />
              {waReady && !(signup && emailCodes) ? <WhatsAppCodeButton loading={busy && channel === "whatsapp"} onPress={() => void request("whatsapp")} /> : null}
              {signup
                ? <Button variant="ghost" size="sm" title="Already have an account? Log in" onPress={() => { setSignup(false); setMode(DEFAULT_LOGIN === "email" ? "email" : "phone"); setErr(null); }} />
                : <>
                    <Button variant="ghost" size="sm" title="Log in with email & password" onPress={() => { setMode("email"); setErr(null); }} />
                    <NewHere onPress={() => { setSignup(true); setErr(null); }} />
                  </>}
              <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>
                By continuing you agree to the OneShort{" "}
                <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/terms")} style={{ textDecorationLine: "underline" }}>Terms of Use</Txt>
                {" "}and{" "}
                <Txt v="small" color={T.primaryDark} accessibilityRole="link" onPress={() => router.push("/legal/privacy")} style={{ textDecorationLine: "underline" }}>Privacy Notice</Txt>
              </Txt>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <CodeField value={f.code} onChange={onCode} error={err} autoFocus />
              {dev ? <DevCode code={dev} onUse={() => onCode(dev)} /> : channel === "email" && emailTest ? <EmailOffNotice prefix={testerPrefix} sent /> : null}
              {simulator && channel === "whatsapp" ? <SimButton phone={mobile} /> : null}
              <Button testID="otp-verify" title="Verify" size="lg" loading={busy} disabled={busy || f.code.length !== 6} onPress={() => void verify()} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Button variant="ghost" size="sm" title={channel === "email" ? "Change details" : "Change number"} onPress={() => { setStep("phone"); setErr(null); }} />
                {wait > 0
                  ? <Txt v="small" color={T.muted} accessibilityLiveRegion="polite">Resend in {wait}s</Txt>
                  : <Button variant="ghost" size="sm" title="Resend code" disabled={busy} onPress={() => void request(channel === "email" ? "sms" : channel)} />}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Shown while the server has no email account connected, so nobody waits for a code that will never arrive. */
function EmailOffNotice({ prefix, sent }: { prefix: string | null; sent?: boolean }) {
  const sample = prefix ? prefix.replace(/^\+(\d{2})(\d{4})(\d{3})/, "+$1 $2 $3") + "123" : null;
  return (
    <View accessibilityRole="alert" style={{ padding: 12, borderRadius: 14, backgroundColor: T.warningBackground, gap: 4 }}>
      <Txt v="smallSemi" color={T.warningText}>{sent ? "No email was sent" : "Emails aren't being sent yet"}</Txt>
      <Txt v="small" color={T.warningText}>
        OneShort isn't connected to an email service yet, so codes can't reach real inboxes.
        {sample ? ` For now, use a test mobile number like ${sample} and the code shows on screen.` : " Please try again later."}
      </Txt>
    </View>
  );
}

/** Sign-up entry: new players register with their mobile number (the code verifies it), never by email. */
function NewHere({ onPress }: { onPress: () => void }) {
  return (
    <Pressable testID="login-signup" accessibilityRole="button" accessibilityLabel="New to OneShort? Create an account" onPress={onPress}
      style={({ pressed }) => ({ marginTop: 6, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface, alignItems: "center" })}>
      <Txt v="small" color={T.muted}>New to OneShort? <Txt v="smallSemi" color={T.primaryDark}>Create an account</Txt></Txt>
    </Pressable>
  );
}

/** One field for the 6-digit code: iOS offers the SMS code above the keyboard, Android reads it, paste works. */
function CodeField({ value, onChange, error, autoFocus }: { value: string; onChange: (v: string) => void; error?: string | null; autoFocus?: boolean }) {
  return (
    <Field testID="otp-code" label="6-digit code" value={value} onChangeText={onChange} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp"
      autoFocus={autoFocus} error={error} style={{ fontSize: 24, letterSpacing: 10, textAlign: "center", fontFamily: "Inter_800ExtraBold" }} />
  );
}

function DevCode({ code, onUse }: { code: string; onUse?: () => void }) {
  return (
    <Text style={{ backgroundColor: T.warningBackground, color: T.warningText, padding: 12, borderRadius: 14 }}>
      Test mode: your code is <Text testID="dev-code" style={{ fontFamily: "Inter_800ExtraBold" }} onPress={onUse}>{code}</Text>
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
