import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { CERT_EMAIL, CERT_USER_ID, DASHBOARD } from "./session";

/**
 * The Preview portal/dashboard authentication topology.
 *
 * Records what a legitimately signed-in synthetic user can and cannot reach.
 * Before the portal fix this documents the failure; after it, the same
 * assertions document the fix. Claim names and the `azp` origin are printed —
 * `azp` is an origin, not a secret — and no token ever is.
 */
test("the certification session traverses the portal to the dashboard", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.loaded({ page });
  await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: CERT_EMAIL } });
  await page.goto("/");
  await clerk.loaded({ page });
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
    undefined,
    { timeout: 20_000 }
  );

  // 1. The session itself is valid and belongs to the synthetic identity.
  const claims = await page.evaluate(async () => {
    const w = window as unknown as {
      Clerk?: { user?: { id?: string }; session?: { getToken: () => Promise<string | null> } };
    };
    const jwt = await w.Clerk?.session?.getToken();
    if (!jwt) return null;
    const c = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { userId: w.Clerk?.user?.id ?? null, azp: c.azp ?? null, iss: c.iss as string };
  });
  expect(claims, "a session token was issued").toBeTruthy();
  expect(claims!.userId).toBe(CERT_USER_ID);
  console.log(`[topology] signed in as ${claims!.userId}; azp=${claims!.azp}; iss=${claims!.iss}`);

  // 2. The browser is using the stable Preview alias.
  expect(claims!.azp).toBe("https://fortmark-app-preview.vercel.app");

  // 3. The dashboard deployment accepts this very session.
  const jwt = await page.evaluate(async () => {
    const w = window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } } };
    return (await w.Clerk?.session?.getToken()) ?? null;
  });
  // The app layout's own sync creates the dashboard_users row for an
  // allowlisted user; cleanup removes it, so a fresh run re-creates it here
  // exactly as a first sign-in would.
  await fetch(`${DASHBOARD}/dashboard/`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: "text/html" },
  });
  const dash = await fetch(`${DASHBOARD}/dashboard/api/contacts`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
  });
  console.log(`[topology] dashboard API with the same session -> ${dash.status}`);
  expect(dash.status, "the dashboard accepts this session").toBe(200);

  // 4. The portal itself: does it serve the dashboard zone to this session?
  await page.goto("/dashboard/ai");
  await page.waitForLoadState("domcontentloaded");
  const landed = page.url();
  console.log(`[topology] portal /dashboard/ai -> ${landed}`);
  expect(landed, "the portal serves the dashboard rather than bouncing to sign-in").not.toContain("/sign-in");
});
