import { expect, test, type Page } from "@playwright/test";
import { LESSONS } from "../../src/lib/lessons";

const simTime = async (page: Page, index = 0) => Number(await page.locator("figure.fig").nth(index).getAttribute("data-sim-time"));

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test("home: the hero scene runs and the route map lists every station", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Watch systems work");
  const t0 = await simTime(page);
  await page.waitForTimeout(1500);
  expect(await simTime(page)).toBeGreaterThan(t0);
  const stations = page.locator('a[href^="/learn/"]:visible');
  expect(await stations.count()).toBeGreaterThanOrEqual(LESSONS.length);
  expect(errors).toEqual([]);
});

for (const lesson of LESSONS) {
  test(`${lesson.code} ${lesson.slug} renders and animates`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/learn/${lesson.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(lesson.title);
    const figures = page.locator("figure.fig");
    await expect(figures).toHaveCount(lesson.slug === "capstone" ? 1 : 2);
    await figures.first().scrollIntoViewIfNeeded();
    const t0 = await simTime(page);
    await page.waitForTimeout(1200);
    expect(await simTime(page)).toBeGreaterThan(t0);
    await expect(figures.first().locator("canvas.stage-canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("a knob reshapes the running scene", async ({ page }) => {
  await page.goto("/learn/caching");
  const fix = page.locator("figure.fig").nth(1);
  await fix.scrollIntoViewIfNeeded();
  const slider = fix.getByRole("slider", { name: "Cache size" });
  await slider.fill("0");
  await expect(fix.locator("output.knob-value")).toHaveText("0 items");
  await expect(fix.locator(".node-sub", { hasText: "/0 items" })).toHaveCount(1);
});

test("space pauses and plays a focused figure; restart resets the clock", async ({ page }) => {
  await page.goto("/learn/latency-and-throughput");
  const fig = page.locator("figure.fig").first();
  await fig.scrollIntoViewIfNeeded();
  const play = fig.getByRole("button", { name: /pause|play/i }).first();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await fig.focus();
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  const paused = await simTime(page);
  await page.waitForTimeout(600);
  expect(await simTime(page)).toBe(paused);
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await fig.getByRole("button", { name: "Restart from the beginning" }).click();
  expect(await simTime(page)).toBeLessThan(paused + 1000);
});

test("a fault button crashes and restores a server", async ({ page }) => {
  await page.goto("/learn/health-checks");
  const fig = page.locator("figure.fig").first();
  await fig.scrollIntoViewIfNeeded();
  await fig.getByRole("button", { name: "Crash server 2" }).click();
  await expect(fig.getByRole("button", { name: "Restore server 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(fig.locator(".node.down")).toHaveCount(1);
  await fig.getByRole("button", { name: "Restore server 2" }).click();
  await expect(fig.locator(".node.down")).toHaveCount(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("figures show a settled still and wait for the viewer", async ({ page }) => {
    await page.goto("/learn/caching");
    const fig = page.locator("figure.fig").first();
    await fig.scrollIntoViewIfNeeded();
    await expect(fig.getByRole("button", { name: "Play" })).toBeVisible();
    await expect.poll(() => simTime(page)).toBeGreaterThan(2000);
    const still = await simTime(page);
    await page.waitForTimeout(800);
    expect(await simTime(page)).toBe(still);
    await expect(fig.locator(".metric .num").first()).not.toHaveText("—");
  });
});

test("the capstone locks later stages and prices the architecture", async ({ page }) => {
  await page.goto("/learn/capstone");
  await expect(page.getByRole("button", { name: /Featured on a blog/ })).toBeDisabled();
  const cost = page.locator(".cap-cost strong");
  const before = await cost.textContent();
  await page.getByRole("switch", { name: "Cache" }).check({ force: true });
  await expect(cost).not.toHaveText(before ?? "");
  await expect(page.locator(".node.g-cache")).toHaveCount(1);
});

test("visited lessons are ticked on the route map", async ({ page }) => {
  await page.goto("/learn/sharding");
  await page.goto("/#route");
  await expect(page.locator('a.seen[href="/learn/sharding"]:visible, a.station.seen[href="/learn/sharding"]').first()).toBeAttached();
});

test("pages fit the screen without sideways scrolling", async ({ page }) => {
  for (const path of ["/", "/learn/load-balancing", "/learn/capstone"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("unknown lessons get a helpful 404", async ({ page }) => {
  const res = await page.goto("/learn/not-a-lesson");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("isn’t on the map");
});
