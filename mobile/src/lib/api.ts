import type { ApiErrorBody, S } from "@cm/shared";

import { API_URL, configReady } from "./config";
import { tokens } from "./tokens";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let onSessionExpired: () => void = () => undefined;
export function setSessionExpiredHandler(fn: () => void) { onSessionExpired = fn; }

let refreshing: Promise<S<"TokenOut"> | null> | null = null;
export function refresh(): Promise<S<"TokenOut"> | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await configReady();
    const rt = await tokens.getRefresh();
    if (!rt) return null;
    const r = await fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) });
    if (!r.ok) { await tokens.clear(); return null; }
    const d = ((await r.json()) as { data: S<"TokenOut"> }).data;
    tokens.setAccess(d.access_token);
    await tokens.setRefresh(d.refresh_token);
    return d;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; form?: FormData; headers?: Record<string, string> };

/** Typed fetch wrapper: unwraps `{data}`, retries once after refreshing an expired token. */
export async function api<T>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  await configReady(); // a beta build may have a saved server override
  const qs = opts.query ? "?" + Object.entries(opts.query).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&") : "";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs}`, { method: opts.method ?? "GET", headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { data?: T } & Partial<ApiErrorBody>;
  if (!res.ok) {
    const code = json.error?.code ?? "HTTP_ERROR";
    if (res.status === 401 && code === "TOKEN_EXPIRED" && !retried && (await refresh())) return api<T>(path, opts, true);
    if (res.status === 401 && tokens.access) onSessionExpired();
    throw new ApiError(res.status, code, json.error?.message ?? "Something went wrong");
  }
  return ("meta" in json ? json : json.data) as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
