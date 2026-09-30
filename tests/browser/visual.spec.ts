import { test, expect } from "@playwright/test";
import { makeConfig, runExperiment } from "../../src/lib/engine";

const scenes = [
  { name: "guided-laptop", width: 1366, height: 768, lesson: "cache-aside" },
  { name: "guided-phone", width: 390, height: 844, lesson: "cache-aside" },
  {
    name: "guided-small-phone",
    width: 320,
    height: 844,
    lesson: "cache-aside",
  },
  {
    name: "dlq-quarantine",
    width: 1440,
    height: 900,
    lesson: "dead-letter",
    event: "dead-letter",
  },
  {
    name: "hash-membership",
    width: 1440,
    height: 900,
    lesson: "consistent-hashing",
    event: "membership",
  },
];

for (const scene of scenes)
  test(`visual: ${scene.name}`, async ({ page }) => {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?concept=${scene.lesson}`);
    await page.waitForURL(`**/?lesson=${scene.lesson}`);
    await expect(
      page.getByRole("button", { name: "Guided lesson", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    if (scene.event) {
      await page
        .getByRole("button", { name: "Experiment", exact: true })
        .last()
        .click();
      const index = runExperiment(makeConfig(scene.lesson)).frames.findIndex(
        (frame) => frame.event.type === scene.event,
      );
      expect(index).toBeGreaterThan(0);
      const timeline = page.getByRole("slider", {
        name: "Replay timeline",
        exact: true,
      });
      await timeline.press("Home");
      for (let step = 0; step < index; step++)
        await timeline.press("ArrowRight");
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    const options = {
      animations: "disabled" as const,
      caret: "hide" as const,
      // Next's development indicator is absent in production and isn't product UI.
      style: "nextjs-portal { display: none !important; }",
      maxDiffPixels: 0,
    };
    if (scene.event)
      await expect(page.locator(".canvas-card")).toHaveScreenshot(
        `${scene.name}.png`,
        options,
      );
    else await expect(page).toHaveScreenshot(`${scene.name}.png`, options);
  });
