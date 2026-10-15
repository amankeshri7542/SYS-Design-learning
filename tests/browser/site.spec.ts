import { expect, test, type Page } from "@playwright/test";
import { LESSONS } from "../../src/lib/lessons";

const simTime = async (page: Page) => Number(await page.locator("[data-sim-time]").first().getAttribute("data-sim-time"));

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** The lesson must fit the screen: the document itself never scrolls. */
async function expectNoPageScroll(page: Page) {
  const [y, x] = await page.evaluate(() => [
    document.documentElement.scrollHeight - innerHeight,
    document.documentElement.scrollWidth - innerWidth,
  ]);
  expect(x, "no sideways scroll").toBeLessThanOrEqual(0);
  expect(y, "no page scroll").toBeLessThanOrEqual(0);
}

test("home: the hero scene runs and the route map lists every station", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Watch systems work");
  const t0 = await simTime(page);
  await page.waitForTimeout(1500);
  expect(await simTime(page)).toBeGreaterThan(t0);
  expect(await page.locator('a[href^="/learn/"]:visible').count()).toBeGreaterThanOrEqual(LESSONS.length);
  expect(errors).toEqual([]);
});

for (const lesson of LESSONS) {
  test(`${lesson.code} ${lesson.slug} fits one screen and animates`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/learn/${lesson.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(lesson.title);
    await expect(page.locator(".theatre canvas.stage-canvas")).toBeVisible();
    const t0 = await simTime(page);
    await page.waitForTimeout(1200);
    expect(await simTime(page)).toBeGreaterThan(t0);
    if (lesson.slug !== "capstone") {
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(lesson.figures.length + 1);
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".step-title")).toHaveText(lesson.figures[1].title);
      await tabs.last().click();
      await expect(page.locator(".takeaways")).toBeVisible();
    }
    await expectNoPageScroll(page);
    expect(errors).toEqual([]);
  });
}

test("the Next button walks the steps and then leaves for the next stop", async ({ page }) => {
  await page.goto("/learn/caching");
  const next = page.locator(".dock .btn-next");
  await next.click();
  await expect(page.getByRole("tab", { name: /With cache/ })).toHaveAttribute("aria-selected", "true");
  await next.click();
  await expect(page.locator(".takeaways")).toBeVisible();
  await next.click();
  await expect(page).toHaveURL(/\/learn\/cdn$/);
});

test("a knob reshapes the running scene", async ({ page }) => {
  await page.goto("/learn/caching");
  await page.getByRole("tab").nth(1).click();
  const slider = page.getByRole("slider", { name: "Cache size" });
  await slider.fill("0");
  await expect(page.locator("output.knob-value")).toHaveText("0 items");
  await expect(page.locator(".node-sub", { hasText: "/0 items" })).toHaveCount(1);
});

test("space pauses and plays; arrow keys change steps; restart resets the clock", async ({ page }) => {
  await page.goto("/learn/latency-and-throughput");
  const play = page.locator(".dock .btn-play");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await page.locator(".why").click();
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  const paused = await simTime(page);
  await page.waitForTimeout(600);
  expect(await simTime(page)).toBe(paused);
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Restart from the beginning" }).click();
  expect(await simTime(page)).toBeLessThan(paused + 1000);
});

test("a fault button crashes and restores a server in both worlds", async ({ page }) => {
  await page.goto("/learn/health-checks");
  await page.getByRole("button", { name: "Crash server 2" }).click();
  await expect(page.getByRole("button", { name: "Restore server 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".node.down")).toHaveCount(1);
  await page.getByRole("tab").nth(1).click();
  await expect(page.getByRole("button", { name: "Restore server 2" })).toBeVisible();
  await page.getByRole("button", { name: "Restore server 2" }).click();
  await expect(page.locator(".node.down")).toHaveCount(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("scenes show a settled still and wait for the viewer", async ({ page }) => {
    await page.goto("/learn/caching");
    await expect(page.locator(".dock .btn-play")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => simTime(page)).toBeGreaterThan(2000);
    const still = await simTime(page);
    await page.waitForTimeout(800);
    expect(await simTime(page)).toBe(still);
    await expect(page.locator(".compare td.num").first()).not.toHaveText("—");
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
  await expectNoPageScroll(page);
});

test("visited lessons are ticked on the route map", async ({ page }) => {
  await page.goto("/learn/sharding");
  await page.goto("/#route");
  await expect(page.locator('a.seen[href="/learn/sharding"], a.station.seen[href="/learn/sharding"]').first()).toBeAttached();
});

test("the home page fits the screen without sideways scrolling", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("unknown lessons get a helpful 404", async ({ page }) => {
  const res = await page.goto("/learn/not-a-lesson");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("isn’t on the map");
});
