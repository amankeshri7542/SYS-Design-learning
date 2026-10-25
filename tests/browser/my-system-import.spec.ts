import { expect, test } from "./fixtures";

// Describe yours: arrows typed or pasted open running, with what the reader changed shown first; a file opens the same
// way; what can't be read is said by line, and nothing opens.

test("arrows typed in open running, and the notes say what was added to make them run", async ({ page }) => {
  await page.goto("/my-system");
  const box = page.getByLabel(/Arrows, one chain a line/);
  await box.fill("API x3 -> Redis, Postgres\nAPI -> Jobs [queue] -> Mailer");
  await expect(page.locator(".my-import-format")).toHaveText("Reads as arrows");
  await page.getByRole("button", { name: "Open it" }).click();
  await page.locator('.theatre .stage:not([data-mode="auto"])').waitFor({ timeout: 20_000 });
  // Users were added in front; the cache stands in front of the database; the mailer takes from the queue.
  await expect(page.locator(".sys-read")).toContainText("Added Users");
  await expect(page.locator(".sys-read")).toContainText("Redis is drawn in front of Postgres");
  for (const name of ["Users", "API 1", "Redis", "Postgres", "Jobs", "Mailer"]) await expect(page.getByRole("button", { name: `What is ${name}?` })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".sys-read")).toHaveCount(0);
  // What someone described is kept in this browser; a template opened and left as it came is not.
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Back to the systems" }).click();
  await expect(page.locator(".my-saved-open")).toHaveCount(1);
  await page.getByRole("button", { name: /^Web app/ }).click();
  await page.locator('.theatre .stage:not([data-mode="auto"])').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Back to the systems" }).click();
  await expect(page.locator(".my-saved-open")).toHaveCount(1);
});

test("a docker-compose file opens from the file picker", async ({ page }) => {
  await page.goto("/my-system");
  await page.locator(".my-import-file input").setInputFiles({
    name: "shop.yml",
    mimeType: "text/yaml",
    buffer: Buffer.from("services:\n  web:\n    image: nginx\n    ports: ['80:80']\n    depends_on: [api]\n  api:\n    build: .\n    depends_on: [db]\n  db:\n    image: postgres:16\n"),
  });
  await page.locator('.theatre .stage:not([data-mode="auto"])').waitFor({ timeout: 20_000 });
  await expect(page.getByLabel("The system's name")).toHaveValue("shop");
  await expect(page.getByRole("button", { name: "What is db?" })).toBeVisible();
});

test("what can't be read is said by line, and nothing opens", async ({ page }) => {
  await page.goto("/my-system");
  await page.getByLabel(/Arrows, one chain a line/).fill("Users -> API\nAPI -> -> DB");
  await page.getByRole("button", { name: "Open it" }).click();
  await expect(page.locator("#my-import-errors")).toContainText("Line 2: there's nothing after an arrow.");
  await expect(page.getByLabel(/Arrows, one chain a line/)).toHaveAttribute("aria-describedby", "my-import-errors");
  await expect(page.locator(".theatre")).toHaveCount(0);
});

test("a file too big to be a system's description is turned away, and says why", async ({ page }) => {
  await page.goto("/my-system");
  await page.locator(".my-import-file input").setInputFiles({ name: "dump.json", mimeType: "application/json", buffer: Buffer.alloc(1_200_000, " ") });
  await expect(page.locator("#my-import-errors")).toContainText("dump.json is 1200 KB; System Lab reads files up to 1000 KB.");
  await expect(page.locator(".theatre")).toHaveCount(0);
});
