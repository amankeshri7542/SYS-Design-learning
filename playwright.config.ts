import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./test-results/artifacts",
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/browser-report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
