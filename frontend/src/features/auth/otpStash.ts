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
