/**
 * PlayR critical path (Expo web build, phone viewport), against the seeded e2e stack:
 *   captain OTP login → create match → invite link + WhatsApp share → new player joins via link →
 *   captain sees them and splits the fee → player sees what they owe → player requests to join a team →
 *   captain approves → a non-participant is refused the fee page.
 * Seeded accounts use the reserved fictional range +44 7700 900xxx; the stack gives them password E2ePlayr2026.
 */
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "E2ePlayr2026";
const CAPTAIN_OTP = "+447700900001"; // Rahul Menon, Sector 18 Kings
const MATCH_CAPTAIN = "imran.khan@example.in"; // Sector 62 Tech XI
const TEAM_CAPTAIN = "kiran.tyagi@example.in"; // Expressway Strikers
const PLAYER = "arjun.rao@example.in";

const run = Date.now().toString().slice(-6);
const newbie = {
  name: `E2E Regular ${run}`,
  mobile: `+447700900${String(800 + (Number(run) % 200)).padStart(3, "0")}`,
  email: `e2e.regular.${run}@example.in`,
  password: "E2eRegular2026",
};
const state: { matchUrl?: string; joinUrl?: string } = {};

test.describe.configure({ mode: "serial" });

async function chooseSport(page: Page) {
  await page.goto("/welcome");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function emailLogin(page: Page, email: string, password = PASSWORD) {
  await chooseSport(page);
  await page.getByRole("button", { name: "Log in with email & password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).last().click();
  await expect(page.getByRole("textbox", { name: "Password" })).toBeHidden(); // signed in (home or agreement)
  await page.waitForLoadState("networkidle");
}

async function acceptAgreementIfShown(page: Page) {
  const agree = page.getByRole("switch", { name: /I agree to the Platform User Agreement/ });
  if (await agree.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
    await agree.click();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }
}

/** Same calendar label the date picker uses, e.g. "Friday, 20 November". */
function dayLabel(d: Date) {
  return `${d.toLocaleDateString("en-GB", { weekday: "long" })}, ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "long" })}`;
}

test("captain logs in with a phone code", async ({ page }) => {
  await chooseSport(page);
  await page.getByLabel("Mobile number").fill(CAPTAIN_OTP);
  await page.getByRole("button", { name: "Continue with OTP" }).click();
  const hint = page.getByText(/Development mode: your code is \d{6}/);
  const code = ((await hint.innerText()).match(/\d{6}/) ?? [""])[0];
  await page.getByLabel("6-digit code").fill(code); // submits on the 6th digit
  await expect(page.getByText("CAPTAIN HUB").first()).toBeVisible();
  await expect(page.getByText("Sector 18 Kings").first()).toBeVisible();
});

test("captain creates a match and shares the invite link on WhatsApp", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; open: (u?: string | URL) => null };
    w.__opened = [];
    w.open = (u) => { w.__opened.push(String(u)); return null; };
  });
  await emailLogin(page, MATCH_CAPTAIN);
  await page.goto("/match/new");
  await page.getByRole("button", { name: "T20" }).click();
  await page.getByRole("button", { name: "Next: Venue" }).click();
  await page.getByRole("button", { name: "Choose a ground" }).click();
  await page.getByRole("button", { name: /^Sector 137 Cricket Ground/ }).click();
  await page.getByRole("button", { name: "Next: Date & time" }).click();

  const day = new Date(Date.now() + 3 * 86_400_000);
  const cell = page.getByRole("button", { name: dayLabel(day), exact: true });
  if (!(await cell.isVisible())) await page.getByRole("button", { name: "Next month" }).click();
  await cell.click();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(page.getByText("Sector 137 Cricket Ground").first()).toBeVisible();
  await page.getByRole("button", { name: "Create match" }).click();

  await expect(page).toHaveURL(/\/match\/[a-f0-9]{24}$/);
  state.matchUrl = new URL(page.url()).pathname;
  await expect(page.getByText("1 / 11").first()).toBeVisible();
  const link = page.getByText(/\/join\/[A-Za-z0-9_-]+$/).first();
  state.joinUrl = new URL((await link.innerText()).trim()).pathname;

  await page.getByRole("button", { name: "Share on WhatsApp" }).click();
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened.length).toBe(1);
  expect(opened[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
  expect(decodeURIComponent(opened[0]!.split("text=")[1]!)).toContain(state.joinUrl);
});

test("join link shows a WhatsApp preview with the match details", async ({ request }) => {
  const html = await (await request.get(state.joinUrl!, { headers: { "user-agent": "WhatsApp/2.24" } })).text();
  expect(html).toMatch(/<meta property="og:title" content="Sector 62 Tech XI: T20 match at Sector 137 Cricket Ground">/);
  expect(html).toMatch(/<meta property="og:description" content="[^"]*10 spots left/);
  expect(html).toContain('property="og:image"');
});

test("a new player signs up through the link and lands in the squad", async ({ page }) => {
  await page.goto(state.joinUrl!);
  await expect(page.getByText("YOU'RE INVITED").first()).toBeVisible();
  await page.getByLabel("Full name").fill(newbie.name);
  await page.getByLabel("Mobile number").fill(newbie.mobile);
  await page.getByLabel("Email").fill(newbie.email);
  await page.getByLabel("Password").fill(newbie.password);
  await page.getByRole("button", { name: "Create account & continue" }).click();
  await expect(page).toHaveURL(/\/agreement/);
  await acceptAgreementIfShown(page);
  await expect(page).toHaveURL(new RegExp(`${state.joinUrl}$`));
  await page.getByRole("button", { name: "Bowler" }).click();
  await page.getByRole("button", { name: "Add me to the squad" }).click();
  await expect(page.getByText("You're in the squad!").first()).toBeVisible();
  await expect(page.getByText("2 of 11 in the squad").first()).toBeVisible();
});

test("captain sees the new player and shares a fee split", async ({ page }) => {
  await emailLogin(page, MATCH_CAPTAIN);
  await page.goto(state.matchUrl!);
  await expect(page.getByText("2 / 11").first()).toBeVisible();
  await expect(page.getByText(`1 joined via link: ${newbie.name}`).first()).toBeVisible();

  await page.getByRole("button", { name: "Split match fee" }).click();
  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByLabel("Amount (₹)").fill("2200");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("₹2,200").first()).toBeVisible();
  await page.getByLabel("How should players pay you?").fill("UPI imran@upi");
  await page.getByRole("button", { name: "Calculate split" }).click();
  await expect(page.getByRole("checkbox", { name: new RegExp(`${newbie.name} ₹1,100`) })).toBeVisible();
  await page.getByRole("button", { name: "Share with players" }).click();
  await expect(page.getByText(/Shared|Collect payments/).first()).toBeVisible();
});

test("the new player sees what they owe", async ({ page }) => {
  await emailLogin(page, newbie.email, newbie.password);
  await acceptAgreementIfShown(page);
  await page.goto("/payments");
  await expect(page.getByText("You owe").first()).toBeVisible();
  await expect(page.getByText("₹1,100").first()).toBeVisible();
  await expect(page.getByText(/Sector 62 Tech XI/).first()).toBeVisible();
});

test("a player requests to join a team and the captain approves", async ({ browser }) => {
  const player = await (await browser.newContext()).newPage();
  await emailLogin(player, PLAYER);
  await player.goto("/find/teams");
  const card = player.getByRole("button", { name: /^Expressway Strikers\./ });
  await expect(card).toBeVisible();
  await player.getByRole("button", { name: "Request to join" }).first().click();
  await expect(player.getByText("Request sent — Expressway Strikers's captain will review it.")).toBeVisible();
  await expect(player.getByRole("button", { name: "Request Pending" })).toBeVisible();

  const captain = await (await browser.newContext()).newPage();
  await emailLogin(captain, TEAM_CAPTAIN);
  await captain.getByRole("button", { name: /Manage Team/ }).first().click();
  await expect(captain).toHaveURL(/\/team\/[a-f0-9]{24}$/);
  await expect(captain.getByText("Join requests (1)")).toBeVisible();
  await expect(captain.getByText("Arjun Rao").first()).toBeVisible();
  await captain.getByRole("button", { name: "Approve" }).click();
  await expect(captain.getByText("Join requests (1)")).toBeHidden();
  await captain.getByRole("tab", { name: /Roster/ }).click();
  await expect(captain.getByRole("button", { name: "Arjun Rao" })).toBeVisible();
});

test("someone outside the match can't open its fee page", async ({ page }) => {
  await emailLogin(page, TEAM_CAPTAIN);
  await page.goto(`/fee?ledger=${state.matchUrl!.split("/").pop()}&title=x`);
  await expect(page.getByText("Only match participants can view fees")).toBeVisible();
});
