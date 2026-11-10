/** Hands the pending OTP context from the request screen to the verification screen. */
export interface OtpContext {
  mobile: string;
  purpose: "register" | "login";
  devOtp: string | null;
  resendAfter: number;
}
const KEY = "cm.otp";
export function stashOtp(ctx: OtpContext): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(ctx)); } catch { memo = ctx; }
}
let memo: OtpContext | null = null;
export function readOtp(): OtpContext | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OtpContext) : memo;
  } catch {
    return memo;
  }
}
export function clearOtp(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  memo = null;
}

/** Sign-up details for the verify step. Memory only (never sessionStorage): it holds a password. */
export type SignupProfile = { full_name: string; email?: string; city?: string; timezone: string; password?: string };
let pendingProfile: SignupProfile | null = null;
export function stashProfile(p: SignupProfile | null): void { pendingProfile = p; }
export function takeProfile(): SignupProfile | null { const p = pendingProfile; pendingProfile = null; return p; }
