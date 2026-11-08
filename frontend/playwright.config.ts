import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a live stack: API on :8000 (seeded dev DB) + Vite on :5173.
 *   cd backend && uv run python -m scripts.seed_data --reset && uv run uvicorn app.main:create_app --factory
 *   cd frontend && npm run dev
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
  ],
});
