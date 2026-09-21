import { defineConfig, devices } from "@playwright/test";

/**
 * Preview certification harness — NOT part of the application build.
 *
 * This exists to run one kind of test that cannot be run any other way: an
 * authenticated end-to-end pass over a deployed Preview, through the real
 * Clerk session, the real middleware, the real allowlist and the real model.
 * Offline suites prove shapes; this proves the running system.
 *
 * Authentication uses Clerk's official Playwright support (`@clerk/testing`),
 * which issues a Testing Token so an automated browser can pass Clerk's bot
 * protection *while still being authenticated by Clerk normally*. Nothing here
 * weakens middleware, relaxes `authorizedParties`, or bypasses the allowlist —
 * the point of the run is that the existing security architecture accepts a
 * legitimately signed-in synthetic user.
 *
 * Everything runs against the portal origin, which serves `/dashboard` through
 * its rewrite. One origin means the browser's own Clerk cookies authenticate
 * every request, so no session token is ever extracted, stored or forwarded.
 */
const PORTAL = process.env.CERT_PORTAL_URL ?? "https://fortmark-app-preview.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  // A certification run is a sequence of dependent live steps against one
  // shared database. Parallelism would have them racing over the same fixture.
  fullyParallel: false,
  workers: 1,
  // Never retry: a live certification that only passes sometimes has failed.
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  // Traces and screenshots can capture a signed-in session. This harness is
  // pointed at a real deployment, so neither is collected.
  use: {
    baseURL: PORTAL,
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
    launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "certification", testMatch: /.*\.spec\.ts/, dependencies: ["setup"] },
  ],
});
