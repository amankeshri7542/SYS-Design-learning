// Gzipped JavaScript each page loads, on a production build: every script a page fetches until the network is idle,
// with Next's link prefetches and the lesson page's idle fetch of the next stop switched off (they are for the next
// page, not this one). Lesson and story pages must stay at or under 200 KB.
//
//   npm run build && npx next start -p 3300
//   npm run weight                     (every page, heaviest first)
//   npm run weight -- caching capstone / (only these: slugs, or paths starting with /)
//
// PORT picks another server.

import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const base = `http://127.0.0.1:${process.env.PORT ?? 3300}`;
const LIMIT = 200;

let paths = process.argv.slice(2).map((s) => (s.startsWith("/") ? s : `/learn/${s}`));
if (!paths.length) {
  const html = await (await fetch(`${base}/`)).text();
  const slugs = [...new Set([...html.matchAll(/href="\/learn\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
  paths = ["/", ...slugs.map((s) => `/learn/${s}`), "/progress", "/glossary", "/my-system"];
}

const browser = await chromium.launch();
const rows = [];
for (const path of paths) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.requestIdleCallback = () => 0;
    window.cancelIdleCallback = () => {};
  });
  const page = await ctx.newPage();
  await page.route("**/*", (route) => {
    const r = route.request();
    return r.headers()["next-router-prefetch"] || /[?&]_rsc=/.test(r.url()) ? route.abort() : route.continue();
  });
  const sizes = new Map();
  page.on("response", async (res) => {
    if (res.request().resourceType() !== "script") return;
    try {
      sizes.set(res.url(), gzipSync(await res.body(), { level: 9 }).length);
    } catch {
      // A script the page gave up on.
    }
  });
  const res = await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (res?.ok()) rows.push({ path, kb: [...sizes.values()].reduce((a, b) => a + b, 0) / 1024 });
  await ctx.close();
}
await browser.close();

rows.sort((a, b) => b.kb - a.kb);
let over = 0;
for (const { path, kb } of rows) {
  const budgeted = path.startsWith("/learn/") || path === "/my-system";
  if (budgeted && kb > LIMIT) over++;
  console.log(`${kb.toFixed(1).padStart(7)} KB  ${path}${budgeted && kb > LIMIT ? `  over ${LIMIT} KB` : ""}`);
}
process.exit(over ? 1 : 0);
