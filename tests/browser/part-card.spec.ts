import { expect, test, type Page } from "./fixtures";

// A station's name on the stage opens its card: what the part is, what it does in this scene, what it is doing now, how
// to read its drawing, and the lesson that teaches it. One tap or click; nothing to look up in the Key.

/** The open card's box, and whether it lies inside the window and the document stayed put. */
const placed = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector(".part-pop")!.getBoundingClientRect();
    return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, scrolled: scrollY };
  });

test("a station's name opens its card, which says what it is and points at the lesson that teaches it", async ({ page }) => {
  await page.goto("/learn/cache-stampede");
  await page.getByRole("button", { name: "What is Cache?" }).click();
  const card = page.getByRole("dialog", { name: "Cache" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Keeps copies of recent answers");
  await expect(card.locator("dt")).toContainText(["Here", "Now", "Read it"]);
  await expect(card).toContainText("Each copy expires after 1.5 s.");
  expect(await placed(page)).toEqual({ inside: true, scrolled: 0 });

  // Esc closes it and hands focus back to the station.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page.getByRole("button", { name: "What is Cache?" })).toBeFocused();

  // The lesson link: one tap from a part to the lesson about it.
  await page.getByRole("button", { name: "What is Cache?" }).click();
  await card.getByRole("link", { name: /Learn more in C1 Caching/ }).click();
  await expect(page).toHaveURL(/\/learn\/caching$/);
});

test("a press anywhere else closes the card, and another station's name opens that one instead", async ({ page }) => {
  await page.goto("/learn/caching");
  await page.getByRole("button", { name: "What is App server?" }).click();
  await expect(page.getByRole("dialog", { name: "App server" })).toBeVisible();
  await page.getByRole("button", { name: "What is Database?" }).click();
  await expect(page.getByRole("dialog", { name: "Database" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "App server" })).toHaveCount(0);
  // A press on plain text the card doesn't cover: the lesson's name in the bar, the beat strip, or the step's title.
  const spot = await page.evaluate(() => {
    const card = document.querySelector(".part-pop")!.getBoundingClientRect();
    for (const sel of [".bar-name", ".theatre .beat", ".step-title"]) {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      if (!r || !r.width) continue;
      const x = r.left + 4;
      const y = r.top + r.height / 2;
      if (x < card.left || x > card.right || y < card.top || y > card.bottom) return { x, y };
    }
    return null;
  });
  expect(spot, "somewhere to press outside the card").not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await expect(page.locator(".part-pop")).toHaveCount(0);
});

test("with a mouse, a hover shows the card while the pointer stays", async ({ page, isMobile }) => {
  test.skip(isMobile, "touch has no hover: a tap opens the card");
  await page.goto("/learn/caching");
  await page.getByRole("button", { name: "What is Database?" }).hover();
  await expect(page.getByRole("dialog", { name: "Database" })).toBeVisible();
  // The pointer may move onto the card to read it…
  await page.getByRole("dialog", { name: "Database" }).hover();
  await page.waitForTimeout(400);
  await expect(page.getByRole("dialog", { name: "Database" })).toBeVisible();
  // …and leaving both closes it.
  await page.locator(".step-title").hover();
  await expect(page.locator(".part-pop")).toHaveCount(0);
});

test("the stations are one Tab stop, and the arrow keys move between them in the order of the flow", async ({ page, isMobile }) => {
  test.skip(isMobile, "a keyboard test");
  await page.goto("/learn/caching");
  const hits = page.locator(".part-hit");
  await expect(hits).toHaveCount(3);
  await expect(page.locator('.part-hit[tabindex="0"]')).toHaveCount(1);
  await page.getByRole("button", { name: "What is Users?" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "What is App server?" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "What is Database?" })).toBeFocused();
  await expect(page.locator('.part-hit[tabindex="0"]')).toHaveAttribute("aria-label", "What is Database?");
  // Enter opens the card and moves focus into it; arrows, Space and the like no longer drive the lesson from there.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Database" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Database" }).getByRole("button", { name: "Close" })).toBeFocused();
});

test("an open card follows its station when the stage changes size", async ({ page, isMobile }) => {
  test.skip(isMobile, "a desktop window resize");
  await page.goto("/learn/caching");
  await page.getByRole("button", { name: "What is Database?" }).click();
  await expect(page.getByRole("dialog", { name: "Database" })).toBeVisible();
  const before = await page.locator(".part-pop").boundingBox();
  await page.setViewportSize({ width: 1180, height: 700 });
  await expect(page.getByRole("dialog", { name: "Database" })).toBeVisible();
  await expect.poll(async () => (await page.locator(".part-pop").boundingBox())?.x).not.toBe(before?.x);
  expect(await placed(page)).toEqual({ inside: true, scrolled: 0 });
});

test("a journey's stations open cards too", async ({ page }) => {
  await page.goto("/learn/capstone");
  await page.getByRole("button", { name: "What is Primary DB?" }).click();
  const card = page.getByRole("dialog", { name: "Primary DB" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Primary database");
  await expect(card.getByRole("link", { name: /Learn more in D2 Read replicas/ })).toBeVisible();
  expect(await placed(page)).toEqual({ inside: true, scrolled: 0 });
});
