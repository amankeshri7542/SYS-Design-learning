import { test, expect, type Page } from "@playwright/test";
import {
  experimentQuery,
  makeConfig,
  runExperiment,
  type Config,
} from "../../src/lib/engine";
import { SESSION_KEY } from "../../src/lib/session";

async function experiment(page: Page, id: string) {
  await page.goto(`/?concept=${id}`);
  await page
    .getByRole("button", { name: "Experiment", exact: true })
    .last()
    .click();
}
async function end(page: Page) {
  await page
    .getByRole("slider", { name: "Replay timeline", exact: true })
    .press("End");
  await expect(page.locator(".play-state")).toContainText("Playback ended");
}
async function stored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    SESSION_KEY,
  );
}
async function seekEvent(page: Page, config: Config, type: string) {
  // The model locates an event; independent assertions below verify its meaning.
  const index = runExperiment(config).frames.findIndex(
    (frame) => frame.event.type === type,
  );
  expect(index).toBeGreaterThan(0);
  const timeline = page.getByRole("slider", {
    name: "Replay timeline",
    exact: true,
  });
  await timeline.press("Home");
  for (let n = 0; n < index; n++) await timeline.press("ArrowRight");
}
const metric = (page: Page, label: string) =>
  page.locator(".metrics > div").filter({ hasText: label }).locator("strong");

for (const [width, height] of [
  [1366, 768],
  [1440, 900],
])
  test(`default Guided action and connected operation are discoverable at ${width}×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Guided lesson", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Run", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Step event", exact: true }),
    ).toBeInViewport();
    await expect(page.locator(".operation-map")).toBeInViewport();
    await expect(page.locator(".guided-question")).toBeInViewport();
    await page.getByRole("button", { name: "Step event", exact: true }).click();
    await expect(page.locator(".play-state")).toContainText("event 1 /");
    await expect(page.locator(".event-explanation h2")).not.toHaveText(
      "Workload ready",
    );
    await page
      .getByRole("button", { name: "Skip prediction", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Try the optional prediction" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });

test("per-lesson drafts retain controls, faults, cursor, mode and baseline through history and refresh", async ({
  page,
}) => {
  await experiment(page, "cache-aside");
  await page
    .getByRole("spinbutton", { name: "Cache slots value", exact: true })
    .fill("5");
  await page
    .getByRole("spinbutton", { name: "Entry lifetime value", exact: true })
    .fill("12");
  await page.locator(".advanced-settings > summary").click();
  await page
    .getByRole("spinbutton", { name: "Workload seed", exact: true })
    .fill("87");
  await page
    .getByRole("button", { name: "Inject failure", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pin current as A", exact: true })
    .click();
  await page.getByLabel("Playback speed", { exact: true }).selectOption("4");
  await page.getByRole("button", { name: "AWS", exact: true }).click();
  const historyBefore = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  const original = (await stored(page)).drafts["cache-aside"];
  expect(original.config.values).toEqual({ ttl: 12, capacity: 5 });
  expect(original.config.faults).toEqual([{ at: 1, active: true }]);
  expect(original.cursor).toBe(2);
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);
  await page.getByRole("button", { name: /^Concept library/ }).click();
  await page
    .getByRole("textbox", { name: "Search concepts" })
    .fill("consistent hashing");
  await page.locator(".concept-card").click();
  await page
    .getByRole("button", { name: "Experiment", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Search concepts" }),
  ).toHaveValue("consistent hashing");
  await page.goBack();
  await expect(page.locator(".play-state")).toContainText("event 2 /");
  await expect(
    page.getByRole("button", { name: "Experiment", exact: true }).last(),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await stored(page)).drafts["cache-aside"]).toEqual(original);
  await page.goForward();
  await expect(
    page.getByRole("textbox", { name: "Search concepts" }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.locator(".play-state")).toContainText("event 1 /");
  await page.reload();
  await expect(page.locator(".play-state")).toContainText("Paused · event 1 /");
  expect((await stored(page)).drafts["cache-aside"]).toEqual(original);
  await page.goBack();
  await page.goBack();
  await page.reload();
  await expect(page.locator(".play-state")).toContainText("Paused · event 2 /");
  await expect(
    page.getByRole("button", { name: "AWS", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Playback speed", { exact: true })).toHaveValue(
    "4",
  );
  expect((await stored(page)).drafts["cache-aside"]).toEqual(original);
});

test("pinned A remains exact, B lists every changed input, and fork preserves the environment", async ({
  page,
}) => {
  await experiment(page, "cache-aside");
  await page
    .getByRole("spinbutton", { name: "Cache slots value", exact: true })
    .fill("5");
  await page
    .getByRole("spinbutton", { name: "Entry lifetime value", exact: true })
    .fill("12");
  await page.locator(".advanced-settings > summary").click();
  await page
    .getByRole("spinbutton", { name: "Workload seed", exact: true })
    .fill("91");
  await page
    .getByRole("button", { name: "Inject failure", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pin current as A", exact: true })
    .click();
  const pinned = (await stored(page)).drafts["cache-aside"].baselineA;
  await page
    .getByRole("spinbutton", { name: "Cache slots value", exact: true })
    .fill("2");
  await page
    .getByRole("spinbutton", { name: "Entry lifetime value", exact: true })
    .fill("7");
  await page
    .getByRole("spinbutton", { name: "Workload seed", exact: true })
    .fill("92");
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  await page
    .getByRole("button", { name: "Recover dependency", exact: true })
    .click();
  await expect(page.locator(".input-differences tbody th")).toHaveText([
    "Entry lifetime",
    "Cache slots",
    "Workload seed",
    "Environment / faults",
  ]);
  await expect(page.locator(".comparison-evidence")).toContainText(
    "These results cannot isolate a single cause",
  );
  expect((await stored(page)).drafts["cache-aside"].baselineA).toEqual(pinned);
  await page
    .getByRole("button", { name: "Fork B from A", exact: true })
    .click();
  const forked = (await stored(page)).drafts["cache-aside"];
  expect(forked.config).toEqual(pinned);
  expect(forked.config.seed).toBe(91);
  expect(forked.config.faults).toEqual([{ at: 1, active: true }]);
  await expect(page.locator(".comparison-evidence")).toContainText(
    "A and B have identical inputs",
  );
  await page
    .getByRole("button", { name: "Hide comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-evidence")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-evidence")).toBeVisible();
});

test("controls express switches, named policies, counts and quantities", async ({
  page,
}) => {
  await experiment(page, "stampede");
  const coalesce = page.getByRole("switch", {
    name: /Coalesce concurrent reads/,
  });
  await expect(coalesce).toBeChecked();
  await coalesce.uncheck();
  expect((await stored(page)).drafts.stampede.config.values.coalesce).toBe(0);
  await experiment(page, "eviction");
  await page
    .getByRole("combobox", { name: "Eviction policy", exact: true })
    .selectOption({ label: "Least frequently used" });
  expect((await stored(page)).drafts.eviction.config.values.policy).toBe(1);
  await page
    .getByRole("button", { name: "Increase Cache slots", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Cache slots value", exact: true }),
  ).toHaveValue("4");
  await experiment(page, "cache-aside");
  await expect(
    page.getByRole("slider", { name: "Entry lifetime", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Workload seed", exact: true }),
  ).toBeHidden();
});

test("dependency repair leaves quarantined work isolated until an explicit DLQ redrive", async ({
  page,
}) => {
  await experiment(page, "dead-letter");
  await end(page);
  await expect(page.locator(".operation-outcome")).toContainText(
    "remains quarantined in the DLQ",
  );
  await expect(page.locator(".operation-outcome")).toHaveClass(
    /outcome-failed/,
  );
  const deadBefore = Number(
    (await metric(page, "In DLQ").innerText()).replace(/[^0-9]/g, ""),
  );
  expect(deadBefore).toBeGreaterThan(0);
  await seekEvent(page, makeConfig("dead-letter"), "recovery");
  await expect(page.locator(".event-explanation")).toContainText(
    "Repair does not redrive",
  );
  await expect(page.locator(".lane-dead-letter")).toContainText("m-1");
  await expect(
    page.getByRole("button", { name: "Redrive DLQ", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Pin current as A", exact: true })
    .click();
  await page.getByRole("button", { name: "Redrive DLQ", exact: true }).click();
  await expect(page.locator(".input-differences tbody th")).toHaveText([
    "Redrive actions",
  ]);
  expect((await stored(page)).drafts["dead-letter"].config.actions).toEqual([
    { at: 17, type: "redrive" },
  ]);
  await end(page);
  await expect(metric(page, "In DLQ")).toHaveText("0messages");
  await expect(page.locator(".operation-outcome")).toContainText(
    "after explicit redrive",
  );
  await expect(page.locator(".operation-outcome")).toHaveClass(
    /outcome-recovered/,
  );
});

test("playback end distinguishes compensated orders from blocked disaster recovery", async ({
  page,
}) => {
  await experiment(page, "sagas");
  await page
    .getByRole("combobox", { name: "Fulfillment result", exact: true })
    .selectOption({ label: "Failure" });
  await end(page);
  await expect(metric(page, "Forward attempts")).toHaveText("3");
  await expect(metric(page, "Forward commits")).toHaveText("2");
  await expect(metric(page, "Compensations attempted")).toHaveText("2");
  await expect(metric(page, "Compensations committed")).toHaveText("2");
  await expect(page.locator(".operation-outcome")).toContainText(
    "The order failed",
  );
  await expect(page.locator(".operation-outcome")).toContainText("compensated");
  const blocked = makeConfig("disaster-recovery");
  blocked.values.restore = 2;
  blocked.faults = [{ at: 2, active: true }];
  await page.goto(`/${experimentQuery(blocked)}`);
  await end(page);
  await expect(metric(page, "Observed unavailability")).toHaveText("30s");
  await expect(metric(page, "Planned restore duration")).toHaveText("2s");
  await expect(metric(page, "Restores complete")).toHaveText("0");
  await expect(page.locator(".operation-outcome")).toContainText(
    "Recovery is not ready",
  );
  await expect(page.locator(".operation-outcome")).toHaveClass(
    /outcome-pending/,
  );
});

test("malformed draft storage is preserved and new interaction stays usable", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "{malformed"),
    SESSION_KEY,
  );
  await page.goto("/");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Saved drafts are unavailable or unrecognized" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  await expect(page.locator(".play-state")).toContainText("event 1 /");
  await page.getByRole("button", { name: /^Concept library/ }).click();
  await page.goBack();
  await expect(page.locator(".play-state")).toContainText("event 1 /");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY),
  ).toBe("{malformed");
});

test("desktop navigation collapses by keyboard without losing the active experiment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?concept=cache-aside");
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  const draft = (await stored(page)).drafts["cache-aside"];
  const before = await page.locator(".app-content").boundingBox();
  const collapse = page.getByRole("button", {
    name: "Collapse navigation",
    exact: true,
  });
  await collapse.focus();
  await page.keyboard.press("Enter");
  const expand = page.getByRole("button", {
    name: "Expand navigation",
    exact: true,
  });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#workspace-navigation")).toBeHidden();
  expect(
    (await page.locator(".app-content").boundingBox())!.width,
  ).toBeGreaterThan(before!.width);
  await expect(page.locator(".play-state")).toContainText("event 1 /");
  expect((await stored(page)).drafts["cache-aside"]).toEqual(draft);
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-navigation")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse navigation", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});
