import { expect, type Page, test } from "@playwright/test";

/** Logs in through the real OTP screen; the dev adapter shows the code on screen. */
async function loginWithOtp(page: Page, mobile: string) {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(page.getByText("Development mode")).toBeVisible();
  const code = (await page.locator("p:has-text('Development mode') button").innerText()).trim();
  await page.getByLabel("Digit 1").fill(code);
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test("new player: register → OTP → agreement → onboarding → home", async ({ page }, info) => {
  const mobile = `7${String(Date.now()).slice(-8)}${info.project.name === "mobile" ? 1 : 2}`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Playwright Pranav");
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Email").fill(`pw${mobile}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();
  const code = (await page.locator("p:has-text('Development mode') button").innerText()).trim();
  await page.getByLabel("Digit 1").fill(code);

  await expect(page.getByRole("heading", { name: "Platform User Agreement", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept and continue" }).click();

  await expect(page.getByRole("heading", { name: "Set up your player profile" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Bowler" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator(".leaflet-container").click({ position: { x: 120, y: 120 } });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByRole("navigation", { name: "Main actions" })).toBeVisible();
  for (const label of ["Find a Player", "Find a Team", "Split a Fee", "Build a Team"]) {
    await expect(page.getByRole("link", { name: new RegExp(label) })).toBeVisible();
  }
});

test("captain: find nearby players for a seeded match", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one login per seeded captain (OTP cooldown)");
  await loginWithOtp(page, "+447700900001");
  await page.goto("/discover/players");
  const select = page.getByLabel("Search for a match");
  const value = await select.locator("option", { hasText: "Sunday Morning T20" }).first().getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("radio", { name: "20 km" }).click();
  await page.getByRole("button", { name: "Search players" }).click();
  await expect(page.getByText(/available players? within 20 km/)).toBeVisible();
  const first = page.locator("text=/~\\d+(\\.5)? km/").first();
  await expect(first).toBeVisible();
  // Location privacy: no raw coordinates in the page
  expect(await page.content()).not.toMatch(/\b28\.[4-6]\d{3,}|\b77\.[3-5]\d{3,}/); // Noida lat/lng ranges

  // CricHeroes: seeded manual data is shown; captain links a team page.
  await page.goto("/teams");
  await page.getByText("Sector 18 Kings").first().click();
  const ch = page.getByRole("region", { name: "CricHeroes" });
  await expect(ch.getByText("Win %")).toBeVisible();
  await expect(ch.getByText("On GoFindr").first()).toBeVisible();
  await expect(ch.getByRole("button", { name: "Sync" })).toBeDisabled();
  await ch.getByRole("button", { name: "Link CricHeroes team" }).click();
  await page.getByLabel("CricHeroes team link").fill("https://cricheroes.in/team-profile/1234567/sector-18-kings/members");
  await page.getByRole("button", { name: "Save link" }).click();
  await expect(ch.getByRole("link", { name: /View on CricHeroes/ })).toHaveAttribute("href", "https://cricheroes.com/team-profile/1234567/sector-18-kings");
  await page.screenshot({ path: "test-results/cricheroes-desktop.png", fullPage: true });
});

test("player: payment dashboard and invitations", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "one login per seeded player (OTP cooldown)");
  await loginWithOtp(page, "+447700900002");
  await page.goto("/invitations");
  await expect(page.getByRole("tab", { name: /Received/ })).toBeVisible();
  await expect(page.getByText("Nets & fielding drills").first()).toBeVisible();
  await page.goto("/payments");
  await expect(page.getByRole("heading", { name: "My payments" })).toBeVisible();
  await expect(page.getByText("Sector 18 Kings").first()).toBeVisible();
});
