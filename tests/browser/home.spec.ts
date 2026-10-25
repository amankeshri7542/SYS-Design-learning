import { expect, test } from "./fixtures";
import { STORIES } from "../../src/lib/lessons";

// The home page's first screen and its journeys: the live scene is in a phone's first screen, its parts explain
// themselves, the first ride's button is in reach, the journeys show one at a time, and no two station names on the
// map touch.

test("the live scene is in the first screen, and the ride's button within a screen and a third", async ({ page }) => {
  await page.goto("/");
  const vh = page.viewportSize()!.height;
  const hero = await page.locator(".hero-fig").boundingBox();
  const start = await page.locator(".masthead .btn-primary").boundingBox();
  expect(hero!.y, "the scene starts in the first screen").toBeLessThan(vh);
  // A phone held sideways is too short for both: the scene comes first, and the ride is a scroll away.
  if (vh >= 520) expect(start!.y + start!.height, "the ride's button is near").toBeLessThan(vh * 1.3);
});

test("the live scene's parts open their cards, which point at the lessons that teach them", async ({ page }) => {
  await page.goto("/");
  await page.locator(".hero-fig").scrollIntoViewIfNeeded();
  await page.locator(".hero-fig").getByRole("button", { name: "What is Load balancer?" }).click();
  const card = page.getByRole("dialog", { name: "Load balancer" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: /Learn more in F3 Load balancing/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
});

test("journeys: one runs at a time, and a tab switches it in place", async ({ page }) => {
  await page.goto("/");
  await page.locator(".journey-board").scrollIntoViewIfNeeded();
  const tabs = page.locator(".journey-board").getByRole("tab");
  await expect(tabs).toHaveCount(STORIES.length);
  await expect(page.locator(".journey-board canvas")).toHaveCount(1);
  const chat = STORIES.find((s) => s.slug === "chat")!;
  await tabs.filter({ hasText: chat.title }).click();
  await expect(page.locator(".journey-feature .journey-title")).toContainText(chat.title);
  await expect(page.locator(".journey-feature .btn-primary")).toHaveAttribute("href", `/learn/${chat.slug}`);
  await expect(page.locator(".journey-board canvas")).toHaveCount(1);
  // The tabs pattern: arrow keys move between journeys.
  await page.keyboard.press("ArrowDown");
  await expect(tabs.filter({ has: page.locator(":scope[aria-selected='true']") })).not.toContainText(chat.title);
});

test("the map: no two station names touch", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 900, "the poster is for wide screens");
  await page.goto("/#route");
  const boxes = await page.locator(".route-svg .station").evaluateAll((links) =>
    links.map((a) => {
      const rs = [...a.querySelectorAll(".station-name")].map((t) => t.getBoundingClientRect());
      return { name: a.getAttribute("aria-label") ?? "", l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)), t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)) };
    }),
  );
  const hits: string[] = [];
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) hits.push(`${a.name} × ${b.name}`);
    }),
  );
  expect(hits).toEqual([]);
});
