import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against the **production bundle**, not the dev server: `npm run build`
 * then `vite preview`. That way the suite exercises the artefact that actually ships
 * (hashed assets, code-split chunks, built-in API base URL).
 *
 * The backend is stubbed at the network layer (see tests/e2e/fixtures.ts) because these are
 * UI-contract tests: they assert that the console renders the documented response shapes and
 * degrades correctly when they are absent. The *real* API contract is verified separately and
 * against a live service by scripts/deploy/verify_deployment.py in the CI docker job.
 */
const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Baked into the bundle at build time. The tests intercept this origin.
      VITE_API_BASE_URL: "http://127.0.0.1:8077",
    },
  },
});
