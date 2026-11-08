import type { ApiErrorBody, S } from "@cm/shared";
import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import { useAuth } from "@/app/store/auth";

export const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Array<Record<string, unknown>> = [],
    public requestId?: string | null,
  ) {
    super(message);
  }

  /** Field-level messages for forms: { field: message } */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) {
      if (typeof d.field === "string" && typeof d.message === "string") out[d.field] = d.message;
    }
    return out;
  }
}

export const http = axios.create({ baseURL: API_BASE, timeout: 20_000 });

http.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** Single-flight refresh: concurrent 401s share one rotation request. */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;
  const { refreshToken, setSession, clear } = useAuth.getState();
  if (!refreshToken) return null;
  refreshing = axios
    .post<{ data: S<"TokenOut"> }>(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken })
    .then((r) => {
      const d = r.data.data;
      setSession(d.access_token, d.refresh_token, d.user);
      return d.access_token;
    })
    .catch(() => {
      clear();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;
    if (error.response?.status === 401 && original && !original._retried && code === "TOKEN_EXPIRED") {
      original._retried = true;
      const token = await refreshSession();
      if (token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return http.request(original);
      }
    }
    if (error.response?.status === 401 && code !== "OTP_INVALID" && code !== "OTP_EXPIRED"
      && code !== "OTP_LOCKED" && code !== "INVALID_CREDENTIALS" && useAuth.getState().accessToken) {
      useAuth.getState().clear();
    }
    const body = error.response?.data?.error;
    throw new ApiError(
      error.response?.status ?? 0,
      body?.code ?? (error.code === "ECONNABORTED" ? "TIMEOUT" : "NETWORK_ERROR"),
      body?.message ?? (error.response ? "Something went wrong" : "Can't reach the server. Check your connection."),
      body?.details ?? [],
      error.response?.data?.request_id,
    );
  },
);

/** Unwrap the `{data}` envelope. */
export async function api<T>(config: AxiosRequestConfig): Promise<T> {
  const r = await http.request<{ data: T }>(config);
  return r.data?.data as T;
}

/** For endpoints that return `{data, meta}`. */
export async function apiPaged<T, M = S<"PageMeta">>(config: AxiosRequestConfig): Promise<{ data: T[]; meta: M }> {
  const r = await http.request<{ data: T[]; meta: M }>(config);
  return r.data;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
