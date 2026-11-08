import { MOBILE_REGEX, normaliseMobile } from "@cm/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";

import { useAuth } from "@/app/store/auth";
import { Segmented } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ApiError, errorMessage } from "@/services/api/client";
import { auth } from "@/services/api/endpoints";

import { AuthLayout } from "./AuthLayout";
import { stashOtp } from "./otpStash";

const mobileSchema = z.object({ mobile: z.string().regex(MOBILE_REGEX, "Enter a valid 10-digit mobile number") });
const emailSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function LoginPage() {
  // VITE_DEFAULT_LOGIN=email for public demo builds where OTP codes aren't delivered (no SMS provider yet).
  const [mode, setMode] = useState<"otp" | "password">(import.meta.env.VITE_DEFAULT_LOGIN === "email" ? "password" : "otp");
  return (
    <AuthLayout title="Welcome back" subtitle={<>New here? <Link to="/register" className="font-semibold text-brand-700 underline">Create an account</Link></>}>
      <Segmented label="Login method" value={mode} onChange={setMode} options={[{ value: "otp", label: "Mobile OTP" }, { value: "password", label: "Email" }]} />
      <div className="mt-6">{mode === "otp" ? <OtpLogin /> : <PasswordLogin />}</div>
    </AuthLayout>
  );
}

function OtpLogin() {
  const nav = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof mobileSchema>>({ resolver: zodResolver(mobileSchema) });
  const submit = f.handleSubmit(async ({ mobile }) => {
    setServerError(null);
    const mobile_number = normaliseMobile(mobile);
    try {
      const r = await auth.sendOtp({ mobile_number, purpose: "login" });
      stashOtp({ mobile: mobile_number, purpose: "login", devOtp: r.dev_otp ?? null, resendAfter: r.resend_after });
      nav("/verify");
    } catch (e) {
      setServerError(e instanceof ApiError && e.code === "ACCOUNT_NOT_FOUND" ? "No account for this number yet. Create one to get started." : errorMessage(e));
    }
  });
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Mobile number" error={f.formState.errors.mobile?.message ?? serverError ?? undefined}>
        {(id, d) => (
          <div className="flex gap-2">
            <span className="grid h-12 place-items-center rounded-2xl bg-sand-200 px-3 text-sm font-semibold text-ink-700">+91</span>
            <Input id={id} aria-describedby={d} aria-invalid={!!f.formState.errors.mobile} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" {...f.register("mobile")} />
          </div>
        )}
      </Field>
      <Button type="submit" block size="lg" loading={f.formState.isSubmitting}>Send OTP</Button>
    </form>
  );
}

function PasswordLogin() {
  const setSession = useAuth((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) });
  const submit = f.handleSubmit(async (v) => {
    setServerError(null);
    try {
      const t = await auth.login(v);
      setSession(t.access_token, t.refresh_token, t.user);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Email" error={f.formState.errors.email?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" {...f.register("email")} />}
      </Field>
      <Field label="Password" error={f.formState.errors.password?.message ?? serverError ?? undefined}>
        {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" {...f.register("password")} />}
      </Field>
      <Button type="submit" block size="lg" loading={f.formState.isSubmitting}>Log in</Button>
      <Link to="/forgot" className="block text-center text-sm font-medium text-brand-700">Forgot password?</Link>
    </form>
  );
}
