import { defineConfig, devices } from "@playwright/test";

/**
 * Critical-path E2E for the OneShort app (Expo web build) against an isolated, freshly seeded stack.
 *   ../scripts/e2e-stack.sh start          # API :8002 on database "cricket_e2e", web :4174
 *   npx playwright test -c playwright.app.config.ts
 * Tests run in order and share state (a match created in one test is joined in the next), so reseed
 * (`e2e-stack.sh start`) before each run.
 */
export default defineConfig({
  testDir: "./e2e-app",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-app" }]],
  use: {
    baseURL: process.env.E2E_APP_URL ?? "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
});
