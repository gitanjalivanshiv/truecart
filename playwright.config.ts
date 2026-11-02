import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Local e2e run: replayed product data and recorded AI runs (deterministic), real PayPal SANDBOX for payments.
// Each test gets a fresh browser context, so a fresh visitor workspace (own mandate and ledger).
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Production build: what judges get, and no on-demand compilation racing the clicks.
        command: `npx next build && npx next start -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 300_000,
        env: {
          DEMO_MODE: "true",
          AGENT_MODE: "replay",
          DATABASE_PATH: "test-results/e2e.db",
          APP_BASE_URL: baseURL,
        },
      },
});
