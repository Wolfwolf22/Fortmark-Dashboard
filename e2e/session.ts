import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

/**
 * Sign in the synthetic certification identity and hand back a session token.
 *
 * Authentication is entirely Clerk's own: a Testing Token gets the automated
 * browser past bot protection, and `clerk.signIn()` performs a real sign-in
 * against the development instance. The resulting session is validated by the
 * application exactly as any other — signature, `azp`, allowlist and actor
 * resolution all apply, and none of them was relaxed for this run.
 *
 * The token is returned in memory and never written to disk, printed, or put
 * into a trace. It is needed because authentication happens on the portal
 * origin while the dashboard deployment is a different origin: a cross-origin
 * fetch from the page is refused by CORS, which is a browser rule rather than
 * an authentication result, so the runner issues those requests itself.
 */
export const CERT_EMAIL = "fortmark.ai.certification+clerk_test@example.com";
export const CERT_USER_ID = "user_3JeOWKOgBRVFdt0KubrrjVfRFyl";
export const DASHBOARD = process.env.CERT_DASHBOARD_URL ?? "https://fortmark-dashboard-preview.vercel.app";

export async function signInCertificationUser(page: Page): Promise<string> {
  await setupClerkTestingToken({ page });

  // Clerk's script occasionally does not finish initialising on a given load,
  // and `clerk.loaded()` then waits forever. Reloading is the whole fix; the
  // retry is bounded so a genuine failure still surfaces as one rather than as
  // a test timeout with no explanation.
  let loaded = false;
  const ATTEMPTS = 5;
  for (let attempt = 1; attempt <= ATTEMPTS && !loaded; attempt += 1) {
    try {
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await clerk.loaded({ page, timeout: 20_000 } as Parameters<typeof clerk.loaded>[0]);
      loaded = true;
    } catch (error) {
      console.log(`[session] Clerk did not initialise on attempt ${attempt}; reloading`);
      if (attempt === ATTEMPTS) throw error;
      // A cold deployment is the usual reason; give it a moment rather than
      // hammering the same instant.
      await page.waitForTimeout(2_000);
    }
  }

  await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: CERT_EMAIL } });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await clerk.loaded({ page, timeout: 30_000 } as Parameters<typeof clerk.loaded>[0]);
  // Clerk restores the session asynchronously after a navigation; getToken()
  // returns null until it has.
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
    undefined,
    { timeout: 20_000 }
  );

  const token = await page.evaluate(async () => {
    const w = window as unknown as {
      Clerk?: { user?: { id?: string }; session?: { getToken: () => Promise<string | null> } };
    };
    return { jwt: (await w.Clerk?.session?.getToken()) ?? null, userId: w.Clerk?.user?.id ?? null };
  });
  if (!token.jwt) throw new Error("Clerk returned no session token");
  if (token.userId !== CERT_USER_ID) {
    throw new Error(`signed in as the wrong identity: ${token.userId}`);
  }
  return token.jwt;
}

/**
 * A fresh session token from the live browser session.
 *
 * Clerk session tokens are deliberately short-lived, so a token captured once
 * cannot be reused across a long-running test — the ten-minute expiry run
 * outlives it. Clerk refreshes the session in the background, so asking the
 * still-open page for a token again yields a current one. The page must stay
 * open for the life of the test.
 */
export async function freshToken(page: Page): Promise<string> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
    undefined,
    { timeout: 30_000 }
  );
  const jwt = await page.evaluate(async () => {
    const w = window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } } };
    return (await w.Clerk?.session?.getToken()) ?? null;
  });
  if (!jwt) throw new Error("Clerk returned no session token on refresh");
  return jwt;
}

/** An authenticated request to the dashboard deployment. */
export function apiFor(jwt: string) {
  return async function api(path: string, init: RequestInit = {}) {
    const res = await fetch(`${DASHBOARD}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: body as Record<string, unknown> };
  };
}

/** Send one chat turn through the real deployed assistant and read the stream. */
export async function chat(jwt: string, messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${DASHBOARD}/dashboard/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return await res.text();
}
