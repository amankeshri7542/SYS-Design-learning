import { expect, test, type Page } from "./fixtures";
import { COURSE, LESSONS, neighbours } from "../../src/lib/lessons";
import { ALL_LESSONS, ALL_STORIES } from "../../src/lib/lessons/all";
import { buildSteps, defaultsOf, headlineOf, type Lesson } from "../../src/lib/lessons/types";
import { formatTarget, isLatency, type MetricSpec } from "../../src/lib/sim/metrics";

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

/** The rows of a lesson's comparison table: every figure's metrics, first label wins (as the player does). */
function tableRows(lesson: Lesson): MetricSpec[] {
  const seen = new Map<string, MetricSpec>();
  for (const f of lesson.figures) for (const m of f.metrics) if (!seen.has(m.label)) seen.set(m.label, m);
  return [...seen.values()].slice(0, 5);
}

const compareRow = (page: Page, label: string) => page.locator(".compare tbody tr", { has: page.locator("th", { hasText: label }) });

/** Narrow screens show the route as a board; wider ones as the poster. */
const boardShown = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 900;

test("home: the hero runs, the counts come from the catalog, and the route lists every live station", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Watch systems work");
  await expect(page.locator(".lede")).toContainText(`${LESSONS.length} lessons`);
  // The hero runs only while it is on screen; on a phone held sideways it starts below the fold.
  await page.locator(".hero-fig").scrollIntoViewIfNeeded();
  const t0 = await simTime(page);
  await page.waitForTimeout(1500);
  expect(await simTime(page)).toBeGreaterThan(t0);
  const route = page.locator(boardShown(page) ? ".route-board" : ".route-poster");
  for (const e of COURSE) await expect(route.locator(`a[href="/learn/${e.slug}"]`)).toHaveCount(1);
  await expect(page.locator(".masthead .btn-primary")).toHaveAttribute("href", `/learn/${COURSE[0].slug}`);
  expect(errors).toEqual([]);
});

test("home: the map bands the zones, and a station's card shows its lesson running", async ({ page }) => {
  test.skip(boardShown(page), "the poster is for wide screens");
  await page.goto("/");
  await expect(page.locator(".route-svg .zone-name")).toHaveText([/Beginner/, /Intermediate/, /Advanced/]);
  // A station sits in the band of its level.
  const bandOf = async (slug: string) => {
    const x = await page.locator(`.station[href="/learn/${slug}"] .station-dot`).evaluate((c) => Number(c.getAttribute("cx")));
    const bands = await page.locator(".zone-band").evaluateAll((rs) => rs.map((r) => [Number(r.getAttribute("x")), Number(r.getAttribute("width"))]));
    return bands.findIndex(([bx, w]) => x >= bx && x < bx + w);
  };
  expect(await bandOf("caching")).toBe(0);
  expect(await bandOf("cache-stampede")).toBe(1);
  expect(await bandOf("consistency-vs-availability")).toBe(2);
  // Hover a station: its card opens with the lesson's first scene running; leaving closes it.
  await page.locator(".route-poster").scrollIntoViewIfNeeded();
  await page.locator('.station[href="/learn/cdn"]').hover();
  const card = page.locator(".preview");
  await expect(card).toBeVisible();
  await expect(card.locator(".preview-title")).toHaveText("Content delivery networks");
  await expect(card.locator(".mini-scene canvas")).toBeVisible();
  const t0 = Number(await card.locator("[data-sim-time]").getAttribute("data-sim-time"));
  await expect.poll(async () => Number(await card.locator("[data-sim-time]").getAttribute("data-sim-time"))).toBeGreaterThan(t0);
  await page.mouse.move(4, 4);
  await expect(card).toHaveCount(0);
  // Keyboard focus opens it too.
  await page.locator('.station[href="/learn/sharding"]').focus();
  await expect(card.locator(".preview-title")).toHaveText("Sharding");
});

test("home: a journey's stops can be traced on the map", async ({ page }) => {
  test.skip(boardShown(page), "the poster is for wide screens");
  await page.goto("/");
  await expect(page.locator(".journey-route")).toHaveCount(0);
  await page.getByRole("button", { name: /S0.s stops/ }).click();
  await expect(page.locator(".journey-route")).toHaveCount(1);
  await expect(page.locator(".journey-stop")).toHaveCount(ALL_STORIES[0].meta.requires!.length);
});

test("home: on narrow screens the board filters by level and finds a lesson by another name", async ({ page }) => {
  test.skip(!boardShown(page), "the board is for narrow screens");
  await page.goto("/");
  const board = page.locator(".route-board");
  // The line of the first stop starts open; the others start closed.
  await expect(board.locator(".board-line details[open]")).toHaveCount(1);
  await board.getByRole("radio", { name: "Advanced" }).check();
  const shown = board.locator(".board-line details[open] li a");
  // Every live entry at that level: lessons, and stories (on their own line).
  await expect(shown).toHaveCount(COURSE.filter((e) => e.level === "advanced").length);
  await board.getByRole("radio", { name: "All" }).check();
  await board.getByRole("searchbox", { name: "Find a lesson" }).fill("thundering herd");
  await expect(shown).toHaveCount(1);
  await expect(shown.first()).toHaveAttribute("href", "/learn/cache-stampede");
  await board.getByRole("searchbox", { name: "Find a lesson" }).fill("zzz");
  await expect(board.locator(".board-found")).toContainText("Nothing matches");
});

test("home: once lessons are visited, the start button carries on from the last one", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((list) => localStorage.setItem("system-lab:visited:v1", JSON.stringify(list)), [COURSE[0].slug, COURSE[1].slug]);
  await page.reload();
  const start = page.locator(".masthead .btn-primary");
  await expect(start).toHaveAttribute("href", `/learn/${COURSE[2].slug}`);
  await expect(start).toContainText(`Continue at ${COURSE[2].code}`);
});

for (const lesson of ALL_LESSONS) {
  test(`${lesson.code} ${lesson.slug} fits one screen and animates`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/learn/${lesson.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(lesson.title);
    await expect(page.locator(".theatre canvas.stage-canvas")).toBeVisible();
    const t0 = await simTime(page);
    await page.waitForTimeout(1200);
    expect(await simTime(page)).toBeGreaterThan(t0);
    // Every response-time row (and any row with a target of its own) says what it is judged against.
    const targets = page.locator(".compare .target, .mrow .target");
    const sloMs = buildSteps(lesson.figures, lesson.figures.map(defaultsOf))[0].sloMs;
    const expected = tableRows(lesson).flatMap((m) => formatTarget(m, sloMs) ?? []);
    expect(expected.length, "response times have targets").toBeGreaterThanOrEqual(tableRows(lesson).filter(isLatency).length);
    await expect(targets).toHaveText(expected);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(lesson.figures.length + 1);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".step-title")).toHaveText(lesson.figures[1].title);
    await tabs.last().click();
    await expect(page.locator(".takeaways")).toBeVisible();
    // Tabs never wrap: a name sits on its tab's one line, or (on a tab squeezed to its number) entirely below it.
    const torn = await tabs.evaluateAll((all) =>
      all
        .filter((t) => {
          const r = t.getBoundingClientRect();
          const n = t.querySelector(".tab-name")!.getBoundingClientRect();
          const shown = n.top < r.bottom - 1;
          const whole = n.bottom <= r.bottom + 0.5 && n.right <= r.right + 0.5;
          if (r.height > 44) return true;
          // A tab that had to give up its name is just its number, not a wide empty pill.
          if (!shown && r.width > 48) return true;
          return t.getAttribute("aria-selected") === "true" ? !(shown && whole) : shown && !whole;
        })
        .map((t) => t.textContent),
    );
    expect(torn, "tabs whose names are cut").toEqual([]);
    // The Recap's next stop is the next lesson on the recommended path.
    const next = neighbours(lesson.slug).next;
    if (next) await expect(page.locator(".dock .btn-next")).toHaveAttribute("href", `/learn/${next.slug}`);
    await expectNoPageScroll(page);
    expect(errors).toEqual([]);
  });
}

for (const { meta, def } of ALL_STORIES) {
  test(`${meta.code} ${meta.slug}: a story fits one screen, shows its target beside live values, and animates`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/learn/${meta.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(meta.title);
    await expect(page.locator(".theatre canvas.stage-canvas")).toBeVisible();
    const t0 = await simTime(page);
    await page.waitForTimeout(1200);
    expect(await simTime(page)).toBeGreaterThan(t0);
    // The target is one cell per condition, each with its live value.
    const sloMs = def.scene(def.start, def.stages[0]).sloMs;
    await expect(page.locator(".story-cell .target")).toHaveText(def.targets.map((t) => formatTarget({ ...t.metric, target: t.max }, sloMs)!));
    await expect(page.locator(".story-cell .num").first()).toBeVisible();
    await expect(page.locator(".mrow .target")).toHaveCount(def.metrics.filter((m) => formatTarget(m, sloMs)).length);
    await expectNoPageScroll(page);
    expect(errors).toEqual([]);
  });

  test(`${meta.code} ${meta.slug}: later stages wait for the one before, and the design has a price`, async ({ page }) => {
    await page.goto(`/learn/${meta.slug}`);
    await expect(page.getByRole("button", { name: new RegExp(def.stages[1].name) })).toBeDisabled();
    const cost = page.locator(".story-cost strong");
    const before = await cost.textContent();
    const sw = def.controls.find((c) => c.kind === "switch");
    if (sw) await page.getByRole("switch", { name: sw.label }).check({ force: true });
    else await page.getByRole("button", { name: `More ${def.controls[0].label.toLowerCase()}` }).click();
    await expect(cost).not.toHaveText(before ?? "");
    await expectNoPageScroll(page);
  });
}

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
  await page.locator(".step-title").click();
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

test("F4: taking a dead server out of rotation reads as a plain −1, not as worse", async ({ page }) => {
  await page.goto("/learn/health-checks");
  await page.getByRole("tab").nth(1).click();
  await page.getByRole("button", { name: "Crash server 2" }).click();
  const row = compareRow(page, "Servers in use");
  await expect(row.locator("td.delta")).toHaveText("−1");
  await expect(row.locator("td.num")).toHaveText(["3", "2"]);
  await expect(row.locator("td.delta")).not.toHaveClass(/\b(up|down)\b/);
  await expect(row.locator("td.best")).toHaveCount(0);
  // Both columns read at full strength; a rule under its heading marks the step on screen.
  for (const cell of await row.locator("td.num").all()) await expect(cell).toHaveCSS("opacity", "1");
  await expect(page.locator(".compare thead th.on")).toHaveText("Health checks");
  // The rows that do carry a verdict still get one.
  await expect(compareRow(page, "Failed").locator("td.delta.up")).toHaveCount(1);
});

for (const slug of ["latency-and-throughput", "consistency-vs-availability"]) {
  test(`${slug}: explore and trade-off steps show plain differences, never a verdict`, async ({ page }) => {
    await page.goto(`/learn/${slug}`);
    await page.getByRole("tab").nth(1).click();
    const verdicts = page.locator(".compare td.delta.up, .compare td.delta.down, .compare td.best");
    await expect(page.locator(".compare td.delta").filter({ hasText: /^[+−]/ }).first()).toBeAttached();
    await expect(verdicts).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(verdicts).toHaveCount(0);
  });
}

test("the clock is stated in plain words on every screen, and it follows the speed", async ({ page, isMobile }) => {
  await page.goto("/learn/caching");
  // In the dock, or on the beat strip on a portrait phone, whose dock has no room for it: exactly one, always visible.
  const clock = page.locator(".slowmo").filter({ visible: true });
  await expect(clock).toHaveCount(1);
  await expect(clock).toHaveText("1 s on screen = 100 ms");
  const portrait = isMobile && (page.viewportSize()?.width ?? 0) < (page.viewportSize()?.height ?? 0);
  await expect(clock).toHaveClass(/slowmo/);
  expect(await clock.evaluate((e) => !!e.closest(".beat"))).toBe(portrait);
  const speed = page.locator(".dock .speed-cycle");
  await expect(speed).toHaveText("1×");
  await expect(speed).toHaveAccessibleName(/1 s on screen = 100 ms/);
  await speed.click();
  await expect(speed).toHaveText("2×");
  await expect(speed).toHaveAccessibleName(/1 s on screen = 200 ms/);
  await expect(clock).toHaveText("1 s on screen = 200 ms");
});

test("the Key opens from the bar and closes with Esc or its close button, handing focus back", async ({ page }) => {
  await page.goto("/learn/caching");
  const button = page.locator(".bar .key-btn");
  const key = page.getByRole("dialog", { name: "What the dots mean" });
  await expect(key).toBeHidden();
  await button.click();
  await expect(key).toBeVisible();
  await expect(key.getByText("Running late.")).toBeVisible();
  // Opening it moves focus inside, to its close button.
  const close = key.getByRole("button", { name: "Close the key" });
  await expect(close).toBeFocused();
  // The key sits under the bar, not on it.
  const [bar, pop] = await Promise.all([page.locator(".bar").boundingBox(), key.boundingBox()]);
  expect(pop!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
  await page.keyboard.press("Escape");
  await expect(key).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(key).toBeHidden();
  await expect(button).toBeFocused();
});

test("Tab moves through the bar, the summary, the panel and then the dock, in that order", async ({ page }) => {
  await page.goto("/learn/health-checks");
  await expect(page.locator(".theatre .stage")).toBeVisible();
  const order = ["bar", "summary-row", "panel", "dock"];
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const region = await page.evaluate((order) => {
      const el = document.activeElement;
      return order.find((r) => el?.closest(`.${r}`)) ?? (el === document.body ? "body" : "other");
    }, order);
    if (region === "body") break;
    if (seen.at(-1) !== region) seen.push(region);
  }
  expect(seen.filter((r) => r !== "other"), "regions are visited once each, in reading order").toEqual(
    order.filter((r) => seen.includes(r)),
  );
  expect(seen).toContain("bar");
  expect(seen).toContain("panel");
  expect(seen).toContain("dock");
});

test("arrow keys, Home and End move between the step tabs, and only the selected tab is a Tab stop", async ({ page }) => {
  await page.goto("/learn/caching");
  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.locator(".step-title")).toHaveText(ALL_LESSONS.find((l) => l.slug === "caching")!.figures[1].title);
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await expect(page.locator(".takeaways")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toHaveAccessibleName("1 No cache");
  expect(await tabs.evaluateAll((all) => all.map((t) => t.tabIndex))).toEqual([0, -1, -1]);
});

// A phone held sideways that is also narrow (667×375) takes the landscape layout, not the portrait one.
test.describe("a small phone held sideways", () => {
  test.use({ viewport: { width: 667, height: 375 } });
  test("keeps the strip above the stage, the clock in the dock and the number above the panel", async ({ page }, info) => {
    test.skip(info.project.name !== "phone-landscape", "a phone layout");
    await page.goto("/learn/health-checks");
    await expect(page.locator(".theatre .stage")).toBeVisible();
    const [strip, stage, summary, panel] = await Promise.all([".theatre .beat", ".theatre .stage", ".summary", ".panel"].map((s) => page.locator(s).boundingBox()));
    expect(strip!.y + strip!.height).toBeLessThanOrEqual(stage!.y + 0.5);
    expect(stage!.height).toBeGreaterThan(200);
    expect(summary!.y + summary!.height).toBeLessThanOrEqual(panel!.y + 0.5);
    await expect(page.locator(".dock .slowmo")).toBeVisible();
    await expect(page.locator(".beat .slowmo")).toBeHidden();
    await expectNoPageScroll(page);
  });
});

// The panel's reading part fits on a laptop screen for every problem and fix: no scrolling to reach a knob or a fault.
test.describe("the panel fits", () => {
  test.use({ reducedMotion: "reduce" });
  for (const lesson of ALL_LESSONS) {
    test(`${lesson.code} ${lesson.slug}: the problem and fix panels never scroll on desktop, and phones keep the headline number in view`, async ({ page, isMobile }) => {
      await page.goto(`/learn/${lesson.slug}`);
      await page.evaluate(() => document.fonts.ready);
      if (!isMobile) {
        for (let i = 0; i < lesson.figures.length; i++) {
          await page.getByRole("tab").nth(i).click();
          await expect(page.locator(".step-title")).toHaveText(lesson.figures[i].title);
          const over = await page.locator(".panel-scroll").evaluate((e) => e.scrollHeight - e.clientHeight);
          expect.soft(over, `“${lesson.figures[i].short}” panel overflows by ${over}px`).toBeLessThanOrEqual(0);
        }
        await expect(page.locator(".summary")).toBeHidden();
        return;
      }
      const summary = page.locator(".summary");
      await expect(summary).toBeInViewport({ ratio: 1 });
      await expect(summary.locator(".summary-label")).toHaveText(headlineOf(lesson.figures));
      await expect(summary.locator(".num")).toHaveCount(lesson.figures.length);
      for (const n of await summary.locator(".num").all()) await expect(n).not.toHaveText(/—/);
      // Tapping it brings the full table into view.
      await summary.click();
      await expect(page.locator(".compare")).toBeInViewport();
    });
  }
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
