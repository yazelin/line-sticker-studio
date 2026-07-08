// Playwright config — static site served by python http.server.
// Two projects: desktop chromium + iPhone-13-ish mobile emulation.
import { defineConfig, devices } from "@playwright/test";

// Let page.route() also intercept service-worker-initiated fetches —
// without this the SW would bypass our worker-API stubs and hit the
// real network during tests.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8917",
    locale: "zh-TW",
  },
  webServer: {
    command: "python3 -m http.server 8917 --bind 127.0.0.1",
    url: "http://127.0.0.1:8917",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
