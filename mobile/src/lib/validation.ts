/** Sign-up form rules, mirrored from the API (app/common/validators.py) so errors show inline before a request. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function nameError(v: string): string | null {
  const t = v.trim();
  return t.length < 2 ? "Enter your name" : t.length > 80 ? "Keep it under 80 characters" : null;
}

export function emailError(v: string): string | null {
  return EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address";
}

/** Strong password for email sign-up: 12+ characters with a letter and a digit (phone-OTP accounts keep the old 8). */
export function passwordError(v: string): string | null {
  if (v.length < 12) return "Use at least 12 characters";
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Include at least one letter and one number";
  return null;
}

export function confirmError(password: string, confirm: string): string | null {
  if (!confirm) return "Enter your password again";
  return confirm === password ? null : "Passwords don't match";
}

export function ageOn(dob: string, today = new Date()): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

/** ISO date or null; 18 to 100 years old, and a real calendar date (no 31 Feb). */
export function dobError(dob: string | null, today = new Date()): string | null {
  if (!dob) return "Enter your date of birth";
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "That date doesn't exist";
  const age = ageOn(dob, today);
  if (age < 18) return "You must be 18 or older to use OneShort";
  if (age > 100) return "Enter a valid date of birth";
  return null;
}

export function rolesError(roles: string[]): string | null {
  return roles.length ? null : "Pick at least one role";
}
