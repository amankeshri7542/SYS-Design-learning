import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { concepts } from "../../src/lib/catalog";
import { getLesson } from "../../src/lib/lessons";
import { makeConfig, runExperiment } from "../../src/lib/engine";

const shotIds = [
  "cache-aside",
  "dead-letter",
  "circuit-breaker",
  "consistent-hashing",
  "replication",
  "network-isolation",
];
async function seekEvent(page: Page, id: string, type: string) {
  const run = runExperiment(makeConfig(id));
  const index = run.frames.findIndex((f) => f.event.type === type);
  expect(index, `${id} must produce ${type}`).toBeGreaterThan(0);
  const slider = page.getByRole("slider", {
    name: "Replay timeline",
    exact: true,
  });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < index; i++) await slider.press("ArrowRight");
  await expect(page.locator(".event-explanation h2")).toHaveText(
    run.frames[index].event.title,
  );
}

for (const [id, type, selector, text] of [
  ["cache-aside", "fill", ".cache-slots", "product"],
  ["dead-letter", "dead-letter", ".lane-dead-letter", "m-1"],
  ["circuit-breaker", "half-open", ".circuit-states .current", "half-open"],
  ["consistent-hashing", "membership", ".hash-ring", "4 nodes"],
  ["replication", "stale-read", ".replica-ledger", "stale"],
  ["sagas", "compensate", ".field-grid", "refunded"],
] as const)
  test(`inspect representative transition: ${id}`, async ({ page }) => {
    await page.goto(`/?concept=${id}`);
    await page
      .getByRole("button", { name: "Experiment", exact: true })
      .last()
      .click();
    if (id === "sagas") {
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("contrast");
      const run = runExperiment(makeConfig(id, true)),
        index = run.frames.findIndex((f) => f.event.type === "compensate");
      const timeline = page.getByRole("slider", {
        name: "Replay timeline",
        exact: true,
      });
      await timeline.focus();
      for (let i = 0; i < index; i++) await timeline.press("ArrowRight");
    } else await seekEvent(page, id, type);
    await expect(page.locator(selector)).toContainText(text);
    mkdirSync("docs/screenshots", { recursive: true });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `docs/screenshots/state-${id}.png`,
      fullPage: true,
    });
  });
async function finish(page: Page) {
  const slider = page.getByRole("slider", {
    name: "Replay timeline",
    exact: true,
  });
  await slider.focus();
  await slider.press("End");
  await expect(page.locator(".play-state")).toContainText("Playback ended");
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const c of concepts)
  test(`all lessons: ${c.id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    let serverSimulation = 0;
    await page.route("**/api/simulate", (route) => {
      serverSimulation++;
      return route.abort();
    });
    await page.goto(`/?concept=${c.id}`);
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Experiment", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "Step event", exact: true }).click();
    await expect(page.locator(".play-state")).toContainText("event 1 /");
    await page.getByLabel("Scenario", { exact: true }).selectOption("contrast");
    await expect(page.getByTestId("clock")).toHaveText("0s");
    await finish(page);
    await page.getByRole("button", { name: "Pin current as A" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Difference" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "AWS", exact: true }).click();
    await noOverflow(page);
    if (shotIds.includes(c.id)) {
      mkdirSync("docs/screenshots", { recursive: true });
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `docs/screenshots/desktop-${c.id}.png`,
        fullPage: true,
      });
    }
    const l = getLesson(c.id);
    if (l.fault) {
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("failure");
      await finish(page);
    }
    expect(serverSimulation).toBe(0);
    expect(errors).toEqual([]);
  });

test("pause freezes metrics, event and canvas; step, seek, speed, inject and share restore", async ({
  page,
  context,
}) => {
  await page.goto("/?concept=cache-aside");
  await page
    .getByRole("button", { name: "Experiment", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("clock")).not.toHaveText("0s");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const snapshot = await page
    .locator(".state-bench,.metrics,.event-explanation")
    .allTextContents();
  await page.waitForTimeout(900);
  expect(
    await page
      .locator(".state-bench,.metrics,.event-explanation")
      .allTextContents(),
  ).toEqual(snapshot);
  await page.getByRole("button", { name: "Inject failure" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Failure scheduled" }),
  ).toBeVisible();
  await page.getByLabel("Playback speed").selectOption("4");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recover dependency" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Recover dependency" }).click();
  await finish(page);
  await page.getByRole("button", { name: "Share experiment" }).click();
  const url = await page
    .getByLabel("Experiment URL", { exact: true })
    .inputValue();
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByTestId("clock")).toHaveText("0s");
  await finish(other);
  expect(await other.locator(".metrics").innerText()).toEqual(
    await page.locator(".metrics").innerText(),
  );
  await page
    .getByRole("slider", { name: "Replay timeline", exact: true })
    .focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("clock")).toHaveText("0s");
});

test("native inspector keyboard focus, prediction, migration, and search", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "system-lab-progress-v1",
      JSON.stringify(["queues", "cache-aside"]),
    ),
  );
  await page.goto("/?concept=cache-aside");
  await expect(page.locator(".nav-progress")).toContainText("2 / 56 explored");
  await seekEvent(page, "cache-aside", "fill");
  const entry = page.locator(".cache-entry").first();
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("dialog", { name: "product-1" })
      .or(page.locator(".detail-dialog[open]")),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
  await page
    .getByRole("radio", { name: "Database reads", exact: true })
    .check();
  await page.getByRole("button", { name: "Check my prediction" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Prediction correct" }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("system-lab-progress-v2")!),
  );
  expect(stored.explored).toContain("queues");
  expect(stored.understood).toEqual(["cache-aside"]);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search concepts" })
    .fill("zz-not-a-concept");
  await expect(page.getByText("No matching concepts")).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page.locator(".concept-card")).toHaveCount(56);
});

test("storage disabled remains usable and malformed URLs give recovery information", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage disabled");
      },
    }),
  );
  await page.goto("/?experiment=%7Bbad");
  await expect(
    page.getByRole("status").filter({ hasText: "invalid JSON" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  await expect(page.getByTestId("clock")).toHaveText("1s");
  await page
    .getByRole("button", { name: "Your progress", exact: true })
    .click();
  await expect(page.locator(".progress-overview")).toContainText("1/56");
});

test("corrupt guest storage survives account switching and further interaction", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("system-lab-progress-v2", "{bad"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  await page.evaluate(() => {
    const payload = btoa(
      JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001" }),
    );
    sessionStorage.setItem(
      "lab-token",
      JSON.stringify({
        token: `header.${payload}.signature`,
        expiresAt: Date.now() + 300000,
      }),
    );
  });
  await expect(page.locator(".workspace-label")).toContainText("Signed in");
  await page.getByRole("button", { name: "AWS & account" }).click();
  await page.getByRole("button", { name: "Sign out locally" }).click();
  await expect(page.locator(".workspace-label")).toContainText("Guest");
  await page.getByRole("button", { name: "Experiment", exact: true }).click();
  await page.getByRole("button", { name: "Step event", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("system-lab-progress-v2")),
  ).toBe("{bad");
});

test("all journey stages and operations expose completed work and independent failures", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build a system", exact: true })
    .click();
  await page.locator(".journey-settings > summary").click();
  for (let stage = 0; stage < 6; stage++) {
    await page
      .getByRole("navigation", { name: "Build stages" })
      .getByRole("button")
      .nth(stage)
      .click();
    for (const operation of ["read", "order", "notification"]) {
      await page
        .getByLabel("Operation", { exact: true })
        .selectOption(operation);
      await page
        .getByRole("slider", { name: "Operation timeline" })
        .press("End");
      await expect(page.locator(".journey-outcomes > b")).toHaveText(
        "Completed",
      );
      await expect(
        page
          .locator(".journey-outcomes")
          .getByText("Pending", { exact: false })
          .locator("strong"),
      ).toHaveText("0");
      await noOverflow(page);
    }
  }
  await page
    .getByRole("navigation", { name: "Build stages" })
    .getByRole("button")
    .nth(1)
    .click();
  await page.getByLabel("Operation", { exact: true }).selectOption("read");
  await page.getByLabel("Product cache", { exact: true }).selectOption("warm");
  await page
    .getByLabel("Source availability", { exact: true })
    .selectOption("unavailable");
  await page.getByRole("slider", { name: "Operation timeline" }).press("End");
  await expect(page.locator(".journey-outcomes > b")).toHaveText("Completed");
  await page
    .getByLabel("Product cache", { exact: true })
    .selectOption("expired");
  await page.getByRole("slider", { name: "Operation timeline" }).press("End");
  await expect(page.locator(".journey-outcomes > b")).toHaveText("Failed");
  await page
    .getByRole("navigation", { name: "Build stages" })
    .getByRole("button")
    .nth(4)
    .click();
  await page
    .getByLabel("Operation", { exact: true })
    .selectOption("notification");
  await page
    .getByLabel("Notification processing", { exact: true })
    .selectOption("repair");
  await page.getByRole("slider", { name: "Operation timeline" }).press("End");
  await expect(page.locator(".journey-outcomes > b")).toHaveText("In DLQ");
  await page
    .getByRole("checkbox", { name: "Schedule an explicit DLQ redrive" })
    .check();
  await page.getByRole("slider", { name: "Operation timeline" }).press("End");
  await expect(page.locator(".journey-outcomes > b")).toHaveText("Completed");
  mkdirSync("docs/screenshots", { recursive: true });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "docs/screenshots/connected-journey.png",
    fullPage: true,
  });
});

for (const width of [320, 390, 768])
  test(`mobile readability, navigation, controls, dialogs at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const id of [
      "cache-aside",
      "dead-letter",
      "circuit-breaker",
      "consistent-hashing",
      "replication",
      "network-isolation",
    ]) {
      await page.goto(`/?concept=${id}`);
      await expect(page.getByTestId("state-bench")).toBeVisible();
      await page
        .getByRole("button", { name: "Experiment", exact: true })
        .last()
        .click();
      await finish(page);
      await noOverflow(page);
      if (id === "cache-aside" && width < 760) {
        await page.getByRole("button", { name: "Tune model" }).click();
        await expect(
          page.getByLabel("Scenario", { exact: true }),
        ).toBeVisible();
        await noOverflow(page);
        await page.getByRole("button", { name: "Hide controls" }).click();
        const topology = page.locator(".operation-map");
        const component = topology
          .locator(".mobile-operation")
          .getByRole("button")
          .first();
        await component.click();
        const sheet = page.locator(".detail-dialog[open]");
        await expect(sheet).toBeVisible();
        const bounds = await sheet.boundingBox();
        expect(bounds!.y + bounds!.height).toBeCloseTo(900, 0);
        await page.getByRole("button", { name: "Close inspector" }).click();
        await expect(component).toBeFocused();
      }
      expect(
        await page
          .locator(".learning-notes p")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      if (width === 390) {
        mkdirSync("docs/screenshots", { recursive: true });
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        await page.screenshot({
          path: `docs/screenshots/mobile-${id}.png`,
          fullPage: true,
        });
      }
    }
    if (width < 760) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Navigation" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeFocused();
    }
  });

test("account separation, cloud failure retry, expired session and logout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("system-lab-progress-v1", JSON.stringify(["queues"]));
    const payload = btoa(
      JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001" }),
    ).replaceAll("=", "");
    sessionStorage.setItem(
      "lab-token",
      JSON.stringify({
        token: `header.${payload}.signature`,
        expiresAt: Date.now() + 300000,
      }),
    );
  });
  let attempts = 0;
  await page.route("**/api/runs", (route) => {
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body:
        attempts === 1
          ? "{}"
          : JSON.stringify({ items: [{ conceptId: "ttl" }] }),
    });
  });
  await page.goto("/");
  await expect(page.locator(".nav-progress")).toContainText("0 / 56 explored");
  await page.getByRole("button", { name: "AWS & account" }).click();
  await page.getByRole("button", { name: "Load account progress" }).click();
  await expect(page.getByRole("status")).toContainText("Cloud load failed");
  await page.getByRole("button", { name: "Load account progress" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Explored lessons loaded",
  );
  expect(attempts).toBe(2);
  await page.getByRole("button", { name: "Sign out locally" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Guest progress restored",
  );
  await expect(page.locator(".nav-progress")).toContainText("1 / 56 explored");
  await page.evaluate(() => {
    const payload = btoa(
      JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001" }),
    );
    sessionStorage.setItem(
      "lab-token",
      JSON.stringify({
        token: `header.${payload}.signature`,
        expiresAt: Date.now() + 300000,
      }),
    );
  });
  await expect(page.locator(".workspace-label")).toContainText("Signed in");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "lab-token",
      JSON.stringify({ token: "expired", expiresAt: 0 }),
    ),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "sign-in expired" }),
  ).toBeVisible();
  await expect(page.locator(".workspace-label")).toContainText("Guest");
});
