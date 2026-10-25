import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

// The learning record: what a learner does in a lesson is kept in this browser and read back on /progress, which can
// download it and clear it. Nothing leaves the browser.

test("a lesson's prediction, check and rating show on the progress page, which downloads and clears them", async ({ page }) => {
  await page.goto("/learn/caching");
  // On to the prediction (Next until it is asked), and answer it.
  for (let i = 0; i < 30 && !(await page.locator(".card.predict .opt").count()); i++) {
    await page.locator(".dock .btn-next").click();
    await page.waitForTimeout(150);
  }
  await page.locator(".card.predict .opt").first().click();
  await expect(page.locator(".card.predict")).toContainText("You said:");
  // The Recap: a check answered, and how it landed.
  await page.getByRole("tab", { name: /Recap/ }).click();
  await page.locator(".card.check .opt").first().click();
  await page.locator(".card.feel .opt", { hasText: "Yes, it’s clear" }).click();
  await expect(page.locator(".feel-note")).toBeVisible();

  await page.goto("/progress");
  const tile = (name: string) => page.locator(".progress-stats > div", { hasText: name });
  await expect(tile("Lessons opened").locator("dd")).toContainText("1");
  await expect(tile("Predictions right").locator("dd")).toContainText("of 1");
  await expect(tile("Checks right").locator("dd")).toContainText("of 1");
  await expect(page.locator(".progress-recent")).toContainText("Found C1 Caching clear");
  await expect(page.locator(".progress-recent")).toContainText("Opened C1 Caching");

  // Download: the record as JSON, the events and the tallies.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my record" }).click()]);
  const kept = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(kept.visited).toContain("caching");
  expect(kept.tallies.caching).toMatchObject({ opened: 1, predicted: 1, checks: 1, recap: true, feel: "clear" });
  expect(kept.events.every((e: { t: number }) => Number.isInteger(e.t))).toBe(true);

  // Clear takes a second press, then everything is gone.
  const clear = page.getByRole("button", { name: /clear everything/i });
  await clear.click();
  await expect(clear).toHaveText("Press again to clear everything");
  await clear.click();
  await expect(page.locator(".progress-empty")).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem("syslab.v1.events"), localStorage.getItem("system-lab:visited:v1")])).toEqual([null, null]);
});
