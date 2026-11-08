import { MOBILE_REGEX, normaliseMobile, OTP_REGEX, PASSWORD_REGEX } from "@cm/shared";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { errorMessage } from "@/services/api/client";
import { auth } from "@/services/api/endpoints";

import { AuthLayout } from "./AuthLayout";

export function ForgotPasswordPage() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [dev, setDev] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!MOBILE_REGEX.test(mobile.replace(/\s/g, ""))) return setError("Enter a valid mobile number");
    setBusy(true); setError(null);
    try {
      const r = await auth.sendOtp({ mobile_number: normaliseMobile(mobile), purpose: "reset_password" });
      setDev(r.dev_otp ?? null); setStep(2);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!OTP_REGEX.test(code)) return setError("Enter the 6-digit code");
    if (!PASSWORD_REGEX.test(pw)) return setError("Password needs 8+ characters with a letter and a number");
    setBusy(true); setError(null);
    try {
      await auth.resetPassword({ mobile_number: normaliseMobile(mobile), code, new_password: pw });
      toast.success("Password updated. Log in with your email.");
      nav("/login");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Reset password" subtitle={<Link to="/login" className="font-semibold text-brand-700">Back to login</Link>}>
      <div className="space-y-4">
        {step === 1 ? (
          <>
            <Field label="Registered mobile number">{(id) => <Input id={id} inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />}</Field>
            <Button block size="lg" onClick={() => void send()} loading={busy}>Send OTP</Button>
          </>
        ) : (
          <>
            {dev && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Development OTP: <span className="font-mono font-bold">{dev}</span></p>}
            <Field label="OTP">{(id) => <Input id={id} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
            <Field label="New password">{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <Button block size="lg" onClick={() => void reset()} loading={busy}>Update password</Button>
          </>
        )}
        {error && <p role="alert" className="text-sm text-ball-600">{error}</p>}
      </div>
    </AuthLayout>
  );
}
