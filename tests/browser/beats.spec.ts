import { expect, test, type Page } from "@playwright/test";

// Concept delivery: beats point at the thing as it happens, wait for the learner, ask before the break, and read the
// same on every screen. The beats themselves are proved in tests/lessons.test.ts; these check the player around them.

const simTime = async (page: Page) => Number(await page.locator("[data-sim-time]").first().getAttribute("data-sim-time"));
const next = (page: Page) => page.locator(".dock .btn-next");
/** The words of the beat on screen: the callout's on a wide stage, the strip's otherwise. */
const beatText = (page: Page) =>
  page.evaluate(() => (document.querySelector(".callout[data-placed]") ?? document.querySelector(".theatre .beat-text"))?.textContent ?? "");

/** Press Next until `done` holds (answering any prediction with its first option). */
async function nextUntil(page: Page, done: () => Promise<boolean>, max = 30) {
  for (let i = 0; i < max && !(await done()); i++) {
    const opt = page.locator(".card.predict .opt");
    if (await opt.count()) await opt.first().click();
    else await next(page).click();
    await page.waitForTimeout(150);
  }
  expect(await done()).toBe(true);
}

test("F1: within 3 s a first-time viewer is pointed at Server's sockets, and the scene stops for the prediction", async ({ page, isMobile }) => {
  await page.goto("/learn/latency-and-throughput");
  // The build line about Server: on a wide stage a callout beside it, on a phone the strip; its sockets outlined.
  await expect(page.locator(".theatre .node.spot-sockets")).toHaveCount(1, { timeout: 3000 });
  await expect.poll(() => beatText(page), { timeout: 3000 }).toContain("Server");
  if (!isMobile) {
    const [callout, server] = await Promise.all([page.locator(".callout[data-placed]").boundingBox(), page.locator(".theatre .node.spot-sockets").boundingBox()]);
    expect(callout, "a callout is on the stage").not.toBeNull();
    // It points at Server: its leader ends on the station's edge.
    const end = await page.locator(".callout-leader circle").boundingBox();
    expect(end!.x + end!.width / 2).toBeGreaterThan(server!.x - 4);
    expect(end!.x + end!.width / 2).toBeLessThan(server!.x + server!.width + 4);
  }
  await nextUntil(page, async () => (await page.locator(".card.predict .opt").count()) > 0);
  await expect(page.locator(".dock .btn-play")).toHaveAttribute("aria-pressed", "false");
  const t = await simTime(page);
  await page.waitForTimeout(700);
  expect(await simTime(page), "both worlds wait for the answer").toBe(t);
  await page.locator(".card.predict .opt").nth(1).click();
  await expect(page.locator(".card.predict")).toContainText("You said: More than double");
  await expect(page.locator(".dock .btn-play")).toHaveAttribute("aria-pressed", "true");
});

test("Next brings on each beat, then the next step, then the next stop", async ({ page }) => {
  await page.goto("/learn/caching");
  await next(page).click();
  await expect(page.getByRole("tab").first(), "a beat, not a step").toHaveAttribute("aria-selected", "true");
  await nextUntil(page, async () => (await page.getByRole("tab", { name: /With cache/ }).getAttribute("aria-selected")) === "true");
  await nextUntil(page, async () => await page.locator(".takeaways").isVisible());
  await next(page).click();
  await expect(page).toHaveURL(/\/learn\/cdn$/);
});

test("A3: the break's button stalls both worlds at once, and the problem column shows the outage within 15 s", async ({ page }) => {
  await page.goto("/learn/retries-and-backoff");
  await nextUntil(page, async () => ((await next(page).textContent()) ?? "").includes("Stall the service"));
  await page.locator(".faults").getByRole("button", { name: "Stall the service" }).click();
  const pressed = Date.now();
  await expect(page.locator(".theatre .node-sub", { hasText: "stalled" })).toHaveCount(1);
  // The other world stalled at the same moment.
  await page.getByRole("tab").nth(1).click();
  await expect(page.locator(".theatre .node-sub", { hasText: "stalled" })).toHaveCount(1);
  await page.getByRole("tab").nth(0).click();
  // Read on, as a learner would, until the problem's Succeeded cell shows the outage.
  const cell = page.locator(".compare tbody tr", { has: page.locator("th", { hasText: "Succeeded" }) }).locator("td.num").first();
  await expect
    .poll(
      async () => {
        if ((await next(page).textContent())?.includes("Continue")) await next(page).click();
        return cell.textContent();
      },
      { timeout: 15000, intervals: [500] },
    )
    .toMatch(/^(0|<1|[1-9])%$/);
  expect(Date.now() - pressed).toBeLessThan(15000);
});

test("each beat is announced once, and not again on a step switch", async ({ page }) => {
  await page.goto("/learn/caching");
  await page.evaluate(() => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    const region = document.querySelector(".theatre .beat [aria-live]")!;
    new MutationObserver(() => {
      const t = region.textContent ?? "";
      if (t) w.__said.push(t);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  for (let i = 0; i < 6; i++) {
    await next(page).click();
    await page.waitForTimeout(250);
  }
  await page.getByRole("tab").nth(1).click();
  await page.getByRole("tab").nth(0).click();
  await page.waitForTimeout(400);
  const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
  expect(said.length).toBeGreaterThanOrEqual(5);
  expect(new Set(said).size, `announced: ${said.join(" | ")}`).toBe(said.length);
});

test("the keys: ] brings on a beat, [ shows the last one again, f follows a request, 2 goes to step 2", async ({ page }) => {
  await page.goto("/learn/caching");
  await page.locator(".step-title").click();
  // Paused, the build lines move only when the keys move them (playing, they also come on by themselves).
  await page.keyboard.press(" ");
  await expect(page.locator(".dock .btn-play")).toHaveAttribute("aria-pressed", "false");
  // Under load the first build lines may come on before the pause takes hold: step back to the first, wherever it got to.
  await expect
    .poll(async () => {
      const text = (await beatText(page)) ?? "";
      if (!text.includes("Users")) await page.keyboard.press(text ? "[" : "]");
      return text;
    })
    .toContain("Users");
  await page.keyboard.press("]");
  await expect.poll(() => beatText(page)).toContain("App server");
  await page.keyboard.press("[");
  await expect.poll(() => beatText(page)).toContain("Users");
  await page.keyboard.press("f");
  await expect(page.locator(".flight")).toBeVisible();
  await expect(page.locator(".dock .btn-follow")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("2");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("following one request shows its life in the flight strip, ending in its total", async ({ page }) => {
  await page.goto("/learn/latency-and-throughput");
  await nextUntil(page, async () => ((await beatText(page)) ?? "").includes("Watch one blue dot"));
  await page.getByRole("button", { name: "Follow one request" }).click();
  const flight = page.locator(".flight");
  await expect(flight).toBeVisible();
  await expect(flight.locator(".flight-text")).toContainText(/Leaves Users|On to|Waits|works on it|heads back|Back at/, { timeout: 8000 });
  // A beat may pause the scene on the way: read on, as a learner would.
  await expect
    .poll(
      async () => {
        if ((await next(page).textContent())?.includes("Continue")) await next(page).click();
        return flight.locator(".flight-text").textContent();
      },
      { timeout: 20000, intervals: [500] },
    )
    .toMatch(/ms in all/);
  await expect(flight.locator(".hop-work")).toHaveCount(1);
});

test("a glossary term opens its definition, and Show me points the stage at it", async ({ page, isMobile }) => {
  await page.goto("/learn/latency-and-throughput");
  // In the text on a desktop; on touch screens a chip in the panel, since a sentence can't hold a 40px target.
  const term = isMobile ? page.locator(".term-chip") : page.locator(".theatre .term:visible");
  await nextUntil(page, async () => (await term.count()) > 0);
  await term.first().click();
  const pop = page.getByRole("dialog", { name: "Worker" });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("sockets");
  await pop.getByRole("button", { name: "Show me" }).click();
  await expect(pop).toBeHidden();
  await expect(page.locator(".theatre .node.spot-sockets")).toHaveCount(1);
});

test("a row of numbers explains itself: the reading, its target, and how long it is averaged over", async ({ page }) => {
  await page.goto("/learn/caching");
  await page.waitForTimeout(1500);
  await page.locator(".compare .mx", { hasText: "Response time" }).click();
  const pop = page.getByRole("dialog", { name: "Response time" });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("The target is 400 ms or less.");
  await expect(pop).toContainText("Averaged over the last 700 ms");
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
});

test("a wrong answer on the Recap points the stage at what answers it", async ({ page }) => {
  await page.goto("/learn/latency-and-throughput");
  await page.getByRole("tab").last().click();
  const check = page.locator(".card.check").first();
  await check.getByRole("button", { name: "4", exact: true }).click();
  await expect(check.locator(".card-why")).toContainText("2 ÷ 0.2 s = 10 a second");
  await expect(check.locator(".opt.right")).toHaveText(/10/);
  await expect(page.locator(".theatre .stage")).toHaveAttribute("data-focus", "");
  await expect(page.locator(".theatre .node.spot-sockets")).toHaveCount(1);
});

test("a callout never covers a station or its label, and stays inside the stage", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones carry the words in the strip");
  for (const slug of ["latency-and-throughput", "caching", "retries-and-backoff"]) {
    await page.goto(`/learn/${slug}`);
    for (let i = 0; i < 9; i++) {
      await page.waitForTimeout(250);
      const bad = await page.evaluate(() => {
        const c = document.querySelector(".callout[data-placed]")?.getBoundingClientRect();
        if (!c) return [];
        const stage = document.querySelector(".theatre .stage")!.getBoundingClientRect();
        const out: string[] = [];
        if (c.left < stage.left || c.top < stage.top || c.right > stage.right || c.bottom > stage.bottom) out.push("outside the stage");
        for (const n of document.querySelectorAll(".theatre .node")) {
          const r = n.getBoundingClientRect();
          if (Math.min(r.right, c.right) - Math.max(r.left, c.left) > 1 && Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top) > 1)
            out.push(n.querySelector(".node-label")?.textContent ?? "?");
        }
        return out;
      });
      expect(bad, `${slug}, beat ${i}`).toEqual([]);
      const opt = page.locator(".card.predict .opt");
      if (await opt.count()) await opt.first().click();
      else await next(page).click();
    }
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("a still frame, the beats as a list, and Step and Next bring each one on without the scene running", async ({ page }) => {
    await page.goto("/learn/latency-and-throughput");
    await expect(page.locator(".watch")).toBeVisible();
    await expect(page.locator(".watch li")).toHaveCount(5);
    await expect.poll(() => simTime(page)).toBeGreaterThan(2000);
    await page.getByRole("button", { name: "Step forward a moment" }).click();
    await expect.poll(() => beatText(page)).toContain("Users");
    for (let i = 0; i < 3; i++) await next(page).click();
    await expect(page.locator(".watch li.now")).toHaveCount(1);
    await expect(page.locator(".dock .btn-play")).toHaveAttribute("aria-pressed", "false");
    const still = await simTime(page);
    await page.waitForTimeout(800);
    expect(await simTime(page), "nothing runs between beats").toBe(still);
    // Following a request runs it to the end at once and shows its whole life.
    await page.getByRole("button", { name: "Follow one request" }).click();
    await expect(page.locator(".flight .flight-text")).toContainText(/ms in all|gave up|failed/);
  });
});

test("the glossary lists every term with the lesson that shows it", async ({ page }) => {
  await page.goto("/glossary");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The words");
  await expect(page.locator("#queue")).toContainText("Queue");
  await page.locator("#queue").getByRole("link").click();
  await expect(page).toHaveURL(/\/learn\/latency-and-throughput$/);
});
