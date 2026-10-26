import { expect, test, type Page } from "./fixtures";
import { big, jaeger, otlp, shop } from "../traces";
import { measure, overlap } from "./stage-measure";

// Replaying a trace: a Jaeger, Zipkin or OpenTelemetry file is read in the browser, previewed as the parts it makes
// (grouped by service, prefix or kind), and opens as a replay on the system its requests ran through: a typical
// request, the slowest and the failed one walk the stations with their spans' own times, and "the second" runs every
// request its own way. Its text is never shown, nothing personal reaches the page or the browser's storage.

/** Planted in the fixtures where real programs put personal data (`traces.ts`): none of it may show. */
const PERSONAL = ["jane", "example.com", "829341", "10.20.30.40", "203.0.113.7", "sk_live", "98765", "x2k9p"];
const running = '.replay .theatre .stage:not([data-mode="auto"])';

/** Drop a trace file on the gallery's Replay a trace. */
async function pick(page: Page, name: string, text: string) {
  await page.goto("/my-system");
  await page.locator(".my-replay .my-import-file input").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
}

/** The stage meets the lessons' rules: labels inside, at full size and clear of each other, nothing over a station or on a rail. */
async function fits(page: Page, isMobile: boolean) {
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
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(scroll, "the document never scrolls").toBeLessThanOrEqual(0);
}

test.describe("a trace file", () => {
  test.use({ reducedMotion: "reduce" });

  test("is previewed, opens as a replay, plays the failed request's spans, and fits the screen", async ({ page, isMobile }) => {
    await pick(page, "checkout-trace.json", jaeger(shop(60)));
    const read = page.locator(".my-trace-read");
    await expect(read).toContainText("Reads as a Jaeger file: 60 requests");
    for (const [name, kind] of [
      ["payments", "Service"],
      ["Redis", "Cache"],
      ["Postgres", "Database"],
      ["orders topic", "Topic"],
    ])
      await expect(read.locator("li", { hasText: name }).first()).toContainText(kind);
    await read.getByRole("button", { name: "Replay it" }).click();
    await page.locator(running).waitFor({ timeout: 30_000 });
    await expect(page.locator(".bar-name")).toHaveText("checkout trace");

    // Three requests to replay; the failed one says where it broke.
    const picks = page.locator(".rp-pick");
    await expect(picks).toHaveCount(3);
    await expect(picks.nth(0)).toContainText("Typical");
    await expect(picks.nth(1)).toContainText("Slowest");
    await expect(picks.nth(2)).toContainText(/Failed.*broke in payments/);
    await page.getByRole("radio", { name: /^Failed/ }).check();
    // Its waterfall: every span, the failed ones marked, each where and how long it ran; the strip replays it (a still
    // where it broke, under reduced motion).
    const rows = page.locator(".rp-fall .rp-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator(".rp-fall .rp-row.err").filter({ hasText: "payments" }).first()).toBeVisible();
    const flight = page.locator(".flight");
    await expect(flight).toContainText("Replaying");
    await expect(flight.locator(".flight-text")).toHaveText(/breaks in payments, \d+(\.\d)? ms in/);
    // The waterfall's numbers are the spans' own: the first row starts at 0, and each says when it began and how long.
    const first = await rows.first().evaluate((el) => ({ t0: Number((el as HTMLElement).dataset.t0), t1: Number((el as HTMLElement).dataset.t1), ms: el.querySelector(".rp-ms")!.textContent }));
    expect(first.t0).toBe(0);
    expect(first.ms).toContain(`${Math.round(first.t1)} ms`);

    // Every station is one of the trace's parts, and the stage keeps to the lessons' rules.
    for (const name of ["Users", "frontend", "catalog", "ads", "checkout", "payments", "Redis", "Postgres", "orders topic", "email"]) {
      await expect(page.getByRole("button", { name: `What is ${name}?` })).toBeVisible();
    }
    await fits(page, isMobile);

    // Nothing personal on the page or in what this browser keeps.
    const shown = await page.evaluate(() => document.body.innerText + JSON.stringify(localStorage));
    for (const s of PERSONAL) expect.soft(shown, `“${s}” shows`).not.toContain(s);

    // The second: the model running every request its way, checked against the trace's times.
    await page.getByRole("button", { name: "Replay the second" }).click();
    await expect(page.getByRole("button", { name: "Back to one request" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".rp-second")).toContainText(/Checked against the trace: 95 in 100 answered within \d+ ms, against \d+ ms \(\d+% off\)/);
    await expect(page.locator(".rp-times")).toContainText("95 in 100 within");
    await expect(flight).toHaveCount(0);

    // Change it opens the builder with the system; back returns to the trace.
    await page.getByRole("button", { name: "Change it" }).click();
    await expect(page.getByLabel("The system's name")).toHaveValue("checkout trace");
    await page.getByRole("button", { name: "Back to the trace" }).click();
    await expect(page.locator(".rp-pick")).toHaveCount(3);
  });
});

test("a 200-service trace opens as at most 14 stations, and regroups in one tap", async ({ page }) => {
  await pick(page, "platform.json", big());
  await expect(page.locator(".my-trace-read")).toContainText("merged");
  await page.getByRole("button", { name: "Replay it" }).click();
  await page.locator(running).waitFor({ timeout: 30_000 });
  const stations = () => page.locator(".replay .stage .part-hit").count();
  expect(await stations()).toBeLessThanOrEqual(14);
  // By kind: behind the way in, one part for each kind.
  await page.locator(".rp-group").getByRole("radio", { name: "Kind", exact: true }).check();
  await expect(page.getByRole("button", { name: "What is Databases?" })).toBeVisible({ timeout: 20_000 });
  expect(await stations()).toBeLessThanOrEqual(4);
  await expect(page.locator(".sys-read")).toContainText("Grouped by kind");
  await page.locator(".rp-group").getByRole("radio", { name: "Service", exact: true }).check();
  await expect(page.getByRole("button", { name: "What is gateway?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "What is Databases?" })).toHaveCount(0);
});

test("OpenTelemetry spans pasted in Describe yours read as a trace, and its text leaves the box", async ({ page }) => {
  await page.goto("/my-system");
  const box = page.getByLabel(/Arrows, one chain a line/);
  await box.fill(otlp(shop(30), true));
  await expect(page.locator(".my-import-format")).toHaveText("Reads as trace file");
  await page.locator(".my-describe").getByRole("button", { name: "Open it" }).click();
  await expect(box).toHaveValue("");
  await expect(page.locator(".my-trace-read")).toContainText("Reads as an OpenTelemetry file: 30 requests");
  await page.getByRole("button", { name: "Replay it" }).click();
  await page.locator(running).waitFor({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "What is payments?" })).toBeVisible();
});

test("a broken trace says what was wrong, and nothing opens", async ({ page }) => {
  const lost = JSON.parse(jaeger(shop(4)));
  lost.data[0].spans[1].processID = "p9";
  await pick(page, "lost.json", JSON.stringify(lost));
  await expect(page.locator(".my-trace-read .my-import-errors")).toContainText("Jaeger trace 1, span 2: its process isn't listed under “processes”, so its service is unknown.");
  await expect(page.locator(".theatre")).toHaveCount(0);
  await page.getByRole("button", { name: "Try another file" }).click();
  await expect(page.locator(".my-replay .my-import-file")).toBeVisible();
});
