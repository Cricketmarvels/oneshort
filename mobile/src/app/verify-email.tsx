/** Verify the email on my account: a 6-digit code is emailed; once proven it can recover the password. */
import type { S } from "@cm/shared";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { Button, Field, InlineNotice, Muted, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SP, T } from "@/theme";

export default function VerifyEmail() {
  const { user, reload } = useAuth();
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<S<"OtpSentOut"> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api<S<"OtpSentOut">>("/auth/email-verify/start", { method: "POST" }),
    onSuccess: (r) => { setSent(r); setErr(null); },
    onError: (e) => setErr(errorText(e)),
  });
  const verify = useMutation({
    mutationFn: () => api("/auth/email-verify", { method: "POST", body: { code } }),
    onSuccess: async () => { await reload(); router.back(); },
    onError: (e) => setErr(errorText(e)),
  });
  if (!user) return null;
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.xl }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6 }}>
        <Txt v="hero" accessibilityRole="header">{user.email_verified ? "Email verified" : "Verify your email"}</Txt>
        <Muted>{user.email ?? "No email on your account yet."}</Muted>
      </View>
      {user.email_verified ? <InlineNotice>This address is verified and can be used to reset your password.</InlineNotice> : !sent ? (
        <>
          <Muted>{"We'll email a 6-digit code. Once verified, this address can be used to reset your password."}</Muted>
          <Button title="Send code" size="lg" loading={send.isPending} disabled={!user.email} onPress={() => send.mutate()} />
        </>
      ) : (
        <>
          <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus
            hint={sent.dev_otp ? `Test mode: your code is ${sent.dev_otp}` : "Check your inbox and spam folder."} style={{ fontSize: 24, letterSpacing: 10, textAlign: "center" }} />
          <Button title="Verify" size="lg" loading={verify.isPending} disabled={code.length !== 6} onPress={() => verify.mutate()} />
          <Button title="Resend code" variant="ghost" size="sm" loading={send.isPending} onPress={() => send.mutate()} />
        </>
      )}
      {err ? <Txt v="small" color={T.dangerText} accessibilityRole="alert">{err}</Txt> : null}
    </ScrollView>
  );
}
