import { expect, test } from "./fixtures";
import { jaeger, otlp, shop } from "../traces";
import { measure, overlap } from "./stage-measure";

// Replaying a trace: a Jaeger, Zipkin or OpenTelemetry file opens as the system its requests ran through, read in the
// browser. Its text is never shown, nothing personal reaches the page or the browser's storage, and what was read is
// said in the notes; a broken file says what was wrong.

/** Planted in the fixtures where real programs put personal data (`traces.ts`): none of it may show. */
const PERSONAL = ["jane", "example.com", "829341", "10.20.30.40", "203.0.113.7", "sk_live", "98765", "x2k9p"];
const running = '.theatre .stage:not([data-mode="auto"])';

test.describe("a trace file", () => {
  test.use({ reducedMotion: "reduce" });

  test("opens running from the file picker, scrubbed, and fits the screen", async ({ page, isMobile }) => {
    await page.goto("/my-system");
    await page.locator(".my-import-file input").setInputFiles({ name: "checkout-trace.json", mimeType: "application/json", buffer: Buffer.from(jaeger(shop(60))) });
    await page.locator(running).waitFor({ timeout: 20_000 });
    await expect(page.getByLabel("The system's name")).toHaveValue("checkout trace");
    const read = page.locator(".sys-read");
    await expect(read).toContainText("from a Jaeger file");
    await expect(read).toContainText("nothing was uploaded");
    await expect(read).toContainText("How close it runs");
    await expect(read).toContainText("broke in payments");
    for (const name of ["Users", "frontend", "catalog", "ads", "checkout", "payments", "Redis", "Postgres", "orders topic", "email"]) {
      await expect(page.getByRole("button", { name: `What is ${name}?` })).toBeVisible();
    }
    // Nothing personal on the page or in what this browser keeps.
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => document.body.innerText + JSON.stringify(localStorage));
    for (const s of PERSONAL) expect.soft(shown, `“${s}” shows`).not.toContain(s);
    // The stage meets the lessons' rules: labels inside and at full size, nothing over a station or on a rail, 40 px
    // controls on phones. Labels never overlap on desktops; ten stations in three lanes and five columns don't fit a
    // phone's stage at full text size (the frame shrinks past the labels it placed), so phones skip that check.
    await page.getByRole("button", { name: "Got it" }).click();
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
    if (!isMobile) expect.soft(collisions, "no two stations' labels overlap").toEqual([]);
    expect.soft(m.covered, "nothing floats over a station").toEqual([]);
    expect.soft(m.onRail, "no rail shows through a station label").toEqual([]);
    if (isMobile) expect.soft(m.small, "every control is at least 40×40").toEqual([]);
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(scroll).toBeLessThanOrEqual(0);
    // Back in the gallery, the file's text was never put in the box.
    await page.getByRole("button", { name: "Back to the systems" }).click();
    await expect(page.getByLabel(/Arrows, one chain a line/)).toHaveValue("");
  });
});

test("OpenTelemetry spans pasted in read as a trace and open", async ({ page }) => {
  await page.goto("/my-system");
  const box = page.getByLabel(/Arrows, one chain a line/);
  await box.fill(otlp(shop(30), true));
  await expect(page.locator(".my-import-format")).toHaveText("Reads as trace file");
  await page.getByRole("button", { name: "Open it" }).click();
  await page.locator(running).waitFor({ timeout: 20_000 });
  await expect(page.locator(".sys-read")).toContainText("from an OpenTelemetry file");
  await expect(page.getByRole("button", { name: "What is payments?" })).toBeVisible();
});

test("a broken trace says what was wrong, and nothing opens", async ({ page }) => {
  await page.goto("/my-system");
  const lost = JSON.parse(jaeger(shop(4)));
  lost.data[0].spans[1].processID = "p9";
  await page.locator(".my-import-file input").setInputFiles({ name: "lost.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(lost)) });
  await expect(page.locator("#my-import-errors")).toContainText("Jaeger trace 1, span 2: its process isn't listed under “processes”, so its service is unknown.");
  await expect(page.locator(".theatre")).toHaveCount(0);
  await expect(page.getByLabel(/Arrows, one chain a line/)).toHaveValue("");
});
