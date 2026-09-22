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
export const PORTAL = process.env.CERT_PORTAL_URL ?? "https://fortmark-app-preview.vercel.app";

/**
 * Bounds for the sign-in sequence.
 *
 * Every one of these is deliberate. Playwright Test leaves `navigationTimeout`
 * and `actionTimeout` at 0 — no limit — so an awaited step inside a retry loop
 * is bounded only by the surrounding hook. One wedged `page.goto` therefore
 * consumed a whole 600s budget while attempts two through five never ran, and
 * the run reported "hook timeout" rather than "Clerk did not initialise".
 *
 * Worst case now: 3 x 30 + 2 x 4 x (25 + 20 + 2) + 120 + 20 = 606s, which is
 * why the hooks that call this carry a 600s budget of their own and the
 * token step gives up first. A bound that does not fit the budget is not a
 * bound.
 */
const NAV_MS = 25_000;
const CLERK_MS = 20_000;
const SIGNIN_MS = 120_000;
const ATTEMPTS = 4;

/** Fail with our own message instead of being killed by the hook's timeout. */
async function withDeadline<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask both origins for a page before driving a browser at them.
 *
 * A Preview deployment that has had no traffic answers its first request cold,
 * and the first request of the run is the one the browser is waiting on. This
 * is an ordinary unauthenticated GET — it establishes nothing and authenticates
 * nobody; it only means the browser is not the one paying for the cold start.
 */
async function warm(): Promise<void> {
  await Promise.allSettled(
    [`${PORTAL}/sign-in`, `${DASHBOARD}/dashboard/ai`].map((url) =>
      fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => undefined)
    )
  );
}

/**
 * Navigate somewhere and wait for Clerk to actually initialise there.
 *
 * Clerk's script intermittently fails to finish loading, and `clerk.loaded()`
 * then waits until something kills it. Reloading is the whole fix.
 *
 * Both steps carry their own timeout, which is the part that was missing:
 * without one on the navigation the loop was bounded by nothing, so a single
 * wedged load spent the entire budget and the remaining attempts never
 * happened. The failure it raises names what the page was actually showing, so
 * a portal that stopped rendering is not filed as a Clerk flake.
 */
async function loadWithClerk(page: Page, path: string): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    let status: number | undefined;
    try {
      const res = await page.goto(path, { waitUntil: "domcontentloaded", timeout: NAV_MS });
      status = res?.status();
      // A document that is not a 200 has no Clerk to wait for: say what it
      // was and go straight to the next attempt.
      if (status !== undefined && status !== 200) throw new Error(`document answered ${status}`);
      // `clerk.loaded` does not honour a timeout of its own — one attempt sat
      // in it for a whole test budget ("Test ended") — so the bound is ours.
      await withDeadline("clerk.loaded", CLERK_MS, clerk.loaded({ page }));
      if (attempt > 1) console.log(`[session] Clerk initialised at ${path} on attempt ${attempt}`);
      return;
    } catch (error) {
      last = error;
      const title = await page.title().catch(() => "(no title)");
      const html = await page.content().catch(() => "");
      const mitigated = await page
        .evaluate(() => document.body?.innerText.includes("Security Checkpoint"))
        .catch(() => false);
      console.log(
        `[session] Clerk did not initialise at ${path} (attempt ${attempt}, status=${status ?? "none"}, title=${JSON.stringify(title)}, htmlLength=${html.length}, challenge=${mitigated}, url=${page.url()}): ${String(error).slice(0, 120)}; reloading`
      );
      await page.waitForTimeout(2_000).catch(() => undefined);
    }
  }
  // Whether the application rendered at all is the line between "the harness
  // could not get Clerk up" and "the product is down". Say which.
  // Bounded like everything else here: under Playwright Test an action has
  // no timeout of its own, and this read once consumed the rest of a hook.
  const rendered = await page
    .locator("h1")
    .first()
    .innerText({ timeout: 5_000 })
    .catch(() => "(nothing)");
  // The title and the first words of the body tell a challenge page
  // ("Vercel Security Checkpoint") apart from a portal that did not render.
  const title = await page.title().catch(() => "(no title)");
  const body = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .then((t) => t.replace(/\s+/g, " ").slice(0, 160))
    .catch(() => "(unreadable)");
  throw new Error(
    `Clerk did not initialise at ${path} in ${ATTEMPTS} attempts. ` +
      `The page rendered: h1=${JSON.stringify(rendered)} title=${JSON.stringify(title)} body=${JSON.stringify(body)}. ` +
      `Last error: ${String(last)}`
  );
}

/**
 * Fetch Clerk's Testing Token, bounded and retried.
 *
 * This is a request to Clerk's API from the runner, and it was the one step
 * in the sequence with no bound of its own: one run sat in it for the whole
 * hook budget and reported nothing, because nothing here had a chance to.
 */
async function testingToken(page: Page): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await withDeadline("setupClerkTestingToken", 30_000, setupClerkTestingToken({ page }));
      return;
    } catch (error) {
      last = error;
      console.log(`[session] the Testing Token request did not complete (attempt ${attempt}); retrying`);
    }
  }
  throw new Error(`Clerk's Testing Token could not be obtained in 3 attempts. Last error: ${String(last)}`);
}

export async function signInCertificationUser(page: Page): Promise<string> {
  await warm();
  await testingToken(page);

  await loadWithClerk(page, "/sign-in");

  // Clerk's own helper, unchanged — a real sign-in against the development
  // instance. Only the wait around it is bounded, so a hung sign-in reports
  // itself rather than surfacing as an unexplained hook timeout.
  await withDeadline(
    "clerk.signIn",
    SIGNIN_MS,
    clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: CERT_EMAIL } })
  );

  // The same retry applies here: Clerk failing to initialise after sign-in is
  // the identical flake, and leaving this call bare is what let one run burn
  // its whole hook budget on a single unlucky load.
  await loadWithClerk(page, "/");
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
