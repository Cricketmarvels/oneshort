import { OTP_REGEX } from "@cm/shared";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { useAuth } from "@/app/store/auth";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/services/api/client";
import { auth } from "@/services/api/endpoints";

import { AuthLayout } from "./AuthLayout";
import { clearOtp, readOtp, stashOtp } from "./otpStash";

export function VerifyOtpPage() {
  const ctx = readOtp();
  const nav = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(ctx?.resendAfter ?? 30);
  const [devOtp, setDevOtp] = useState(ctx?.devOtp ?? null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!ctx) return <Navigate to="/login" replace />;
  const code = digits.join("");

  const verify = async (c = code) => {
    if (!OTP_REGEX.test(c)) return setError("Enter the 6-digit code");
    setBusy(true);
    setError(null);
    try {
      const t = await auth.verifyOtp({ mobile_number: ctx.mobile, code: c, purpose: ctx.purpose });
      clearOtp();
      setSession(t.access_token, t.refresh_token, t.user);
      nav(t.user.agreement.satisfied ? "/" : "/agreement", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setDigits(Array(6).fill(""));
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const setAt = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      setDigits([...next, ...Array(6 - next.length).fill("")]);
      if (next.length === 6) void verify(next.join(""));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) void verify(next.join(""));
  };

  const resend = async () => {
    try {
      const r = await auth.sendOtp({ mobile_number: ctx.mobile, purpose: ctx.purpose });
      stashOtp({ ...ctx, devOtp: r.dev_otp ?? null, resendAfter: r.resend_after });
      setDevOtp(r.dev_otp ?? null);
      setCooldown(r.resend_after);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <AuthLayout title="Verify your number" subtitle={<>Enter the code sent to <strong className="text-ink-900">{ctx.mobile}</strong></>}>
      <form onSubmit={(e) => { e.preventDefault(); void verify(); }} className="space-y-6">
        <fieldset>
          <legend className="sr-only">One-time password</legend>
          <div className="flex justify-between gap-2">
            {digits.map((d, i) => (
              <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${i + 1}`} maxLength={i === 0 ? 6 : 1}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus(); }}
                className="tabular h-14 w-full rounded-2xl bg-white text-center text-2xl font-bold ring-1 ring-sand-300 focus:outline-none focus:ring-2 focus:ring-brand-500" />
            ))}
          </div>
        </fieldset>
        {devOtp && (
          <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <strong>Development mode:</strong> SMS isn't configured, so your code is <button type="button" className="font-mono font-bold underline" onClick={() => { setDigits(devOtp.split("")); void verify(devOtp); }}>{devOtp}</button>
          </p>
        )}
        {error && <p role="alert" className="text-sm text-ball-600">{error}</p>}
        <Button type="submit" block size="lg" loading={busy}>Verify</Button>
        <p className="text-center text-sm text-ink-500">
          Didn't get it?{" "}
          {cooldown > 0 ? <span>Resend in {cooldown}s</span> : <button type="button" onClick={() => void resend()} className="font-semibold text-brand-700">Resend OTP</button>}
        </p>
      </form>
    </AuthLayout>
  );
}
