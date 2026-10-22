import { expect, test, type Page } from "@playwright/test";

// Motion that teaches has to land every frame, follow one timing family, and stay out of the way of reduced motion.

const simTime = async (page: Page) => Number(await page.locator("[data-sim-time]").first().getAttribute("data-sim-time"));

/**
 * Every animation running on the page now: its name, duration and delay. Live readouts (meters, change bars, a rail's
 * traffic glow) glide continuously between values the scene produces, and the browser shortens a glide it reverses
 * midway, so they are left out of the choreography: `readouts: true` puts them back.
 */
const running = (page: Page, readouts = false) =>
  page.evaluate((readouts) =>
    document
      .getAnimations()
      .filter((a) => readouts || !(a.effect as KeyframeEffect).target?.matches(".meter .fill, .delta-bar, .link-flow"))
      .map((a) => {
        const t = a.effect!.getTiming();
        return { name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty, duration: Number(t.duration), delay: Number(t.delay) };
      }),
  readouts);

// These run in their own projects (playwright.config.ts), after everything else and one at a time.
test.describe("frame budget", () => {
  test.describe.configure({ mode: "serial" });
  // Wrap requestAnimationFrame before the app loads: record each frame's time and how long the app's callback took.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __frames: number[]; __work: number[] };
      w.__frames = [];
      w.__work = [];
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          const start = performance.now();
          cb(t);
          w.__work.push(performance.now() - start);
          if (w.__frames[w.__frames.length - 1] !== t) w.__frames.push(t);
        });
    });
  });

  /** Throttle the CPU 4×, run for `ms`, and read the frame gaps and the app's per-frame work. */
  async function measure(page: Page, ms: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __work: number[] };
      w.__frames.length = 0;
      w.__work.length = 0;
    });
    await page.waitForTimeout(ms);
    const { frames, work } = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __work: number[] };
      return { frames: [...w.__frames], work: [...w.__work] };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const gaps = frames.slice(1).map((t, i) => t - frames[i]);
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
    return { gaps: p95(gaps), worst: Math.max(...gaps), work: p95(work), frames: frames.length };
  }

  test("rate limiting at 2× stays inside the frame budget with the CPU slowed 4×", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CPU throttling needs Chromium");
    await page.goto("/learn/rate-limiting");
    await page.locator(".dock .speed-cycle").click();
    await expect(page.locator(".dock .speed-cycle")).toHaveText("2×");
    await page.waitForTimeout(1200);
    const m = await measure(page, 5000);
    expect(m.frames, "the loop ran").toBeGreaterThan(100);
    expect(m.gaps, "frame gap p95 (ms)").toBeLessThanOrEqual(17);
    expect(m.worst, "longest frame gap (ms)").toBeLessThanOrEqual(34);
    expect(m.work, "app work per frame p95 (ms)").toBeLessThanOrEqual(4);
  });

  test("the built-out capstone stays inside the frame budget with the CPU slowed 4×", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CPU throttling needs Chromium");
    await page.goto("/learn/capstone");
    for (const name of ["Cache", "Rate limiter"]) await page.getByRole("switch", { name }).check({ force: true });
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "More app servers" }).click();
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "More read replicas" }).click();
    await page.waitForTimeout(1500);
    const m = await measure(page, 5000);
    expect(m.frames, "the loop ran").toBeGreaterThan(100);
    expect(m.gaps, "frame gap p95 (ms)").toBeLessThanOrEqual(17);
    expect(m.worst, "longest frame gap (ms)").toBeLessThanOrEqual(34);
    expect(m.work, "app work per frame p95 (ms)").toBeLessThanOrEqual(4);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the scene is a still frame: no intro, no rings, nothing moving", async ({ page }) => {
    await page.goto("/learn/caching");
    await expect.poll(() => simTime(page)).toBeGreaterThan(2000);
    const still = await simTime(page);
    await expect(page.locator(".stage[data-intro]")).toHaveCount(0);
    await page.getByRole("tab").nth(1).click();
    await expect(page.locator(".fresh-ring")).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(await simTime(page)).toBe(still);
    // Animations and transitions are all switched off, so nothing on the page runs (or would run) at all.
    expect((await running(page, true)).filter((a) => a.duration > 0.1)).toEqual([]);
  });
});

test("a step switch is two beats of one timing family", async ({ page }) => {
  await page.goto("/learn/read-replicas");
  // Let the intro play out first: it is the one moment with its own, longer timings.
  const stage = page.locator(".theatre .stage");
  await expect(stage).toHaveAttribute("data-intro", "");
  await expect(stage).not.toHaveAttribute("data-intro", { timeout: 4000 });
  await page.getByRole("tab").nth(1).click();
  await page.waitForTimeout(30);
  const all = await running(page);
  expect(all.length, "the switch animates").toBeGreaterThan(3);
  const family = [120, 160, 240, 480];
  expect(all.filter((a) => !family.includes(a.duration)), "durations off the scale").toEqual([]);
  expect(all.filter((a) => a.delay !== 0 && a.delay !== 120), "delays other than the two beats").toEqual([]);
  // The second beat is used: the new replicas enter after the glide has started.
  expect(all.some((a) => a.name === "node-in" && a.delay === 120)).toBe(true);
});

test("parts a step takes away leave instead of vanishing", async ({ page }) => {
  await page.goto("/learn/caching");
  await page.getByRole("tab").nth(1).click();
  await expect(page.locator(".theatre .node.g-cache")).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.getByRole("tab").nth(0).click();
  // The cache fades where it stood, then is gone.
  await expect(page.locator(".theatre .node.leaving.g-cache")).toHaveCount(1);
  await expect(page.locator(".theatre .node.g-cache")).toHaveCount(0, { timeout: 1000 });
});

test("the scene builds in along the flow once, and the next lesson builds only what it adds", async ({ page }) => {
  await page.goto("/learn/load-balancing");
  const stage = page.locator(".theatre .stage");
  await expect(stage).toHaveAttribute("data-intro", "");
  const delays = await page.evaluate(() =>
    [...document.querySelectorAll(".theatre .node")].map((n) => getComputedStyle(n).animationDelay),
  );
  // Stations stagger 60 ms apart by their place along the flow, starting at once.
  expect(new Set(delays).size).toBeGreaterThan(1);
  expect(delays).toContain("0s");
  await expect(stage).not.toHaveAttribute("data-intro", { timeout: 3000 });
  await page.getByRole("tab").nth(1).click();
  await expect(stage).not.toHaveAttribute("data-intro");
  // F3 → F4 by the bar's next arrow: the users and servers are already there; only what F4 adds builds in.
  await page.getByRole("link", { name: /Next lesson/ }).click();
  await expect(page).toHaveURL(/health-checks$/);
  await expect(page.locator(".theatre .stage")).toHaveAttribute("data-intro", "");
  await expect(page.locator(".theatre .node.known").first()).toBeAttached();
});

test("R2: an open breaker slides its pill to open and breaks the payments rail", async ({ page }) => {
  await page.goto("/learn/circuit-breakers");
  await page.getByRole("tab").nth(1).click();
  await page.locator(".dock .speed-cycle").click();
  const pill = page.locator(".theatre .pill");
  await expect(pill).toHaveAttribute("data-state", "closed");
  await expect(pill).toHaveAttribute("data-state", "open", { timeout: 20000 });
  await expect(page.locator(".theatre .break-mark")).toHaveCount(1);
  // The marker sits at the third place along the pill's foot.
  const moved = await pill.locator(".pill-marker").evaluate((m) => new DOMMatrix(getComputedStyle(m).transform).m41);
  expect(moved).toBeGreaterThan(0);
});
