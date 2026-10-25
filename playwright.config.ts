import { defineConfig, devices } from "@playwright/test";

/** The frame-budget tests: CPU-throttled timing that other tests running alongside would distort. */
const FRAMES = /frame budget/;

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./test-results/artifacts",
  timeout: 45_000,
  // Three workers share one dev server that compiles pages as they're asked for: give assertions room under load.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", grepInvert: FRAMES, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop-short", grepInvert: FRAMES, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    { name: "mobile", grepInvert: FRAMES, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "phone-landscape", grepInvert: FRAMES, use: { ...devices["Pixel 7 landscape"], viewport: { width: 844, height: 390 } } },
    // Frame budgets are measured on a quiet machine: after every other test, one page at a time.
    {
      name: "frames-desktop",
      grep: FRAMES,
      dependencies: ["desktop", "desktop-short", "mobile", "phone-landscape"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "frames-mobile", grep: FRAMES, dependencies: ["frames-desktop"], use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
