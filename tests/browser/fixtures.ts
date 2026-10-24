import { test as base, expect, type Page } from "@playwright/test";

export { expect, type Page };

/**
 * The browser tests' `test`: after loading a lesson or story page, wait until React has taken over the stage (it has
 * measured its box and picked a layout). A click before then is lost, which a loaded dev server makes likely.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      // A lesson that loaded (not a 404) has a stage to wait for.
      if (/\/learn\//.test(url) && response?.ok()) await page.locator('.theatre .stage:not([data-mode="auto"])').first().waitFor({ timeout: 20_000 });
      return response;
    };
    await use(page);
  },
});
