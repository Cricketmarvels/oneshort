/// <reference types="jest" />
jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});
jest.mock("expo-constants", () => ({ expoConfig: { extra: { apiUrl: "http://api.test/api/v1" } } }));

import * as SecureStore from "expo-secure-store";

import { api, ApiError } from "@/lib/api";
import { tokens } from "@/lib/tokens";

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe("mobile api client", () => {
  beforeEach(() => { tokens.setAccess(null); });

  it("refreshes an expired access token once and retries, storing the rotated refresh token securely", async () => {
    tokens.setAccess("old-access");
    await SecureStore.setItemAsync("cm.refresh", "refresh-1");
    const calls: string[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/users/me") && calls.length === 1) return json(401, { error: { code: "TOKEN_EXPIRED", message: "expired", details: [] } });
      if (url.endsWith("/auth/refresh")) return json(200, { data: { access_token: "new-access", refresh_token: "refresh-2", user: {} } });
      return json(200, { data: { full_name: "Arjun" } });
    }) as unknown as typeof fetch;
    const me = await api<{ full_name: string }>("/users/me");
    expect(me.full_name).toBe("Arjun");
    expect(calls).toEqual(["GET http://api.test/api/v1/users/me", "POST http://api.test/api/v1/auth/refresh", "GET http://api.test/api/v1/users/me"]);
    expect(tokens.access).toBe("new-access");
    expect(await SecureStore.getItemAsync("cm.refresh")).toBe("refresh-2");
  });

  it("surfaces API errors with codes", async () => {
    globalThis.fetch = jest.fn(async () => json(422, { error: { code: "SQUAD_FULL", message: "The squad is already full", details: [] } })) as unknown as typeof fetch;
    await expect(api("/invitations/x/confirm", { method: "POST" })).rejects.toEqual(new ApiError(422, "SQUAD_FULL", "The squad is already full"));
  });
});
