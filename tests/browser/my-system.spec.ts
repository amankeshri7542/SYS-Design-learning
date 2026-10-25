import { expect, test, type Page } from "./fixtures";
import { TEMPLATES } from "../../src/lib/system/templates";
import { measure, overlap } from "./stage-measure";

// My System: a template opens running in one tap, its stage meets the lessons' stage-fit rules on every screen, and the
// builder's loop works: open a part from its card, add a part, see what breaks, try the fix side by side, keep it,
// crash a part, and share a link that reopens the same system.

async function open(page: Page, name: string) {
  await page.goto("/my-system");
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.locator('.theatre .stage:not([data-mode="auto"])').waitFor({ timeout: 20_000 });
}

test.describe("every template's stage is legible and inside the stage", () => {
  test.use({ reducedMotion: "reduce" });
  for (const t of TEMPLATES) {
    test(`${t.name}`, async ({ page, isMobile }) => {
      await open(page, t.name);
      await page.waitForTimeout(300);
      const m = await measure(page);
      for (const x of m.texts) {
        const where = `“${x.text}” (${x.kind})`;
        expect.soft(x.l, `${where} starts inside the stage`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(x.t, `${where} starts inside the stage`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(x.r, `${where} ends inside the stage`).toBeLessThanOrEqual(m.stage.w + 0.5);
        expect.soft(x.b, `${where} ends inside the stage`).toBeLessThanOrEqual(m.stage.h + 0.5);
        expect.soft(x.px, `${where} renders at full size`).toBeGreaterThanOrEqual((x.kind === "node-label" ? 12 : 11) - 0.05);
      }
      const labels = m.texts.filter((x) => x.kind === "node-label" || x.kind === "node-sub");
      const collisions = labels.flatMap((a, j) => labels.slice(j + 1).filter((b) => a.owner !== b.owner && overlap(a, b)).map((b) => `“${a.text}” × “${b.text}”`));
      expect.soft(collisions, "no two stations' labels overlap").toEqual([]);
      expect.soft(m.covered, "nothing floats over a station").toEqual([]);
      expect.soft(m.onRail, "no rail shows through a station label").toEqual([]);
      if (isMobile) expect.soft(m.small, "every control is at least 40×40").toEqual([]);
      // The document never scrolls; on phones only the panel does.
      const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      expect(scroll).toBeLessThanOrEqual(0);
    });
  }
});

test("a station's card opens its part for changing, and a part added is wired in where it goes", async ({ page }) => {
  await open(page, "Web app");
  await page.getByRole("button", { name: "What is Database?" }).click();
  await page.getByRole("dialog", { name: "Database" }).getByRole("button", { name: "Change it" }).click();
  await expect(page.getByRole("button", { name: /^Database/, expanded: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Database");
  await page.getByRole("button", { name: "Add a part" }).click();
  await page.getByRole("button", { name: /^Queue/ }).click();
  // A queue comes with a worker taking its jobs, and both are on the stage.
  await expect(page.getByRole("button", { name: "What is Queue?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "What is Worker?" })).toBeVisible();
  await expect(page.locator(".sys-issues")).toHaveCount(0);
});

test("what breaks: measured, with the fix to try side by side, and kept", async ({ page }) => {
  await open(page, "Web app");
  await page.getByRole("tab", { name: "What breaks" }).click();
  const list = page.locator(".sys-blast li");
  await expect(list.first()).toContainText("Takes it all down");
  const db = list.filter({ hasText: "If Database dies" });
  await expect(db).toContainText("of requests fail while it is down");
  await db.getByRole("button", { name: "Try the fix" }).click();
  // Two worlds on the same traffic: the table has both columns and a change.
  await expect(page.locator(".compare thead th")).toContainText(["Yours", "Changed", "Change"]);
  await expect(page.getByRole("button", { name: "What is Copy 1?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep the change" }).click();
  await expect(page.locator(".compare thead th")).not.toContainText(["Changed"]);
  await page.getByRole("tab", { name: "Your system" }).click();
  await expect(page.locator(".sys-part", { hasText: "Database" })).toContainText("1 copy, failover");
});

test("crashing a part takes its station down, and bringing it back restores it", async ({ page }) => {
  await open(page, "Start small");
  const faults = page.getByRole("combobox", { name: /Break something/ });
  await faults.selectOption("crash:service");
  await expect(page.locator(".theatre .node.down")).toHaveCount(1);
  await expect(faults.locator("option").first()).toHaveText("1 fault on");
  await faults.selectOption("crash:service");
  await expect(page.locator(".theatre .node.down")).toHaveCount(0);
});

test("a shared link reopens the same system in a fresh browser", async ({ page, browser }) => {
  await open(page, "Background jobs");
  await page.getByLabel("The system's name").fill("Sign-up mail");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page).toHaveURL(/\/my-system#s=1\./);
  const url = page.url();
  const other = await browser.newPage();
  await other.goto(url);
  await other.locator('.theatre .stage:not([data-mode="auto"])').waitFor({ timeout: 20_000 });
  await expect(other.getByLabel("The system's name")).toHaveValue("Sign-up mail");
  await expect(other.getByRole("button", { name: "What is Email queue?" })).toBeVisible();
  await other.close();
});

test("explain like I'm new walks the parts in the order a request meets them, from the start each time", async ({ page }) => {
  await open(page, "Web app");
  const explain = page.getByRole("button", { name: /^Explain/ });
  await explain.click();
  await expect(explain).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".beat-text")).toContainText("Users send about", { timeout: 5_000 });
  // Asked again, it stops; asked a third time, it starts over from the first part.
  await explain.click();
  await expect(explain).toHaveAttribute("aria-pressed", "false");
  await explain.click();
  await expect(page.locator(".beat-text")).toContainText("Users send about", { timeout: 5_000 });
});
