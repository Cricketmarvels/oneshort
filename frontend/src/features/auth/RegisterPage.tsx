import { DEFAULT_CITY, MOBILE_REGEX, normaliseMobile, PASSWORD_REGEX } from "@cm/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ApiError, errorMessage } from "@/services/api/client";
import { auth } from "@/services/api/endpoints";

import { AuthLayout } from "./AuthLayout";
import { stashOtp } from "./otpStash";

const schema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(80),
  mobile: z.string().regex(MOBILE_REGEX, "Enter a valid 10-digit mobile number"),
  email: z.email("Enter a valid email"),
  city: z.string().trim().min(2, "Which city do you play in?").max(60),
  password: z.string().optional().refine((v) => !v || PASSWORD_REGEX.test(v), "At least 8 characters with a letter and a number"),
});
type Form = z.infer<typeof schema>;

export function RegisterPage() {
  const nav = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const f = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { city: DEFAULT_CITY } });
  const e = f.formState.errors;
  const submit = f.handleSubmit(async (v) => {
    setServerError(null);
    const mobile_number = normaliseMobile(v.mobile);
    try {
      const r = await auth.register({
        full_name: v.full_name, mobile_number, email: v.email, city: v.city,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", password: v.password || null,
      });
      stashOtp({ mobile: mobile_number, purpose: "register", devOtp: r.otp.dev_otp ?? null, resendAfter: r.otp.resend_after });
      nav("/verify");
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [k, msg] of Object.entries(err.fieldErrors)) f.setError((k === "mobile_number" ? "mobile" : k) as keyof Form, { message: msg });
      }
      setServerError(errorMessage(err));
    }
  });
  return (
    <AuthLayout title="Create your account" subtitle={<>One account for playing <em>and</em> captaining. Already registered? <Link to="/login" className="font-semibold text-brand-700 underline">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" error={e.full_name?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" {...f.register("full_name")} />}</Field>
        <Field label="Mobile number" error={e.mobile?.message} hint="We'll send a 6-digit OTP to verify it">
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" {...f.register("mobile")} />}
        </Field>
        <Field label="Email" error={e.email?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" {...f.register("email")} />}</Field>
        <Field label="City" error={e.city?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="address-level2" {...f.register("city")} />}</Field>
        <Field label="Password" optional error={e.password?.message} hint="Lets you log in with email too">
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" {...f.register("password")} />}
        </Field>
        {serverError && <p role="alert" className="rounded-2xl bg-ball-50 p-3 text-sm text-ball-600">{serverError}</p>}
        <Button type="submit" block size="lg" loading={f.formState.isSubmitting}>Continue</Button>
      </form>
    </AuthLayout>
  );
}
