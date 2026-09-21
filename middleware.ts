import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { signInUrl } from "@/lib/routes";

/**
 * Clerk middleware for the dashboard zone.
 *
 * Next.js 15 keeps the `middleware.ts` convention (Next 16 renamed it to
 * `proxy.ts`, which is what the portal app uses — do not rename this file).
 *
 * Everything this zone serves is private, so the matcher below is the inverse
 * of a public allowlist: framework internals and static asset extensions
 * only. API routes are matched explicitly so no endpoint can be exposed by a
 * path that merely escapes the negative lookahead.
 */

/** The only routes served without a session. Everything else is protected. */
const isPublicRoute = createRouteMatcher([
  // Clerk's own frontend endpoints must stay reachable to establish a session.
  "/__clerk/(.*)",
  // The readiness probe. It reports which data source each domain resolved to
  // and nothing else — no records, no counts, no configuration values — and it
  // has to answer before anyone signs in, which is the whole point of it.
  "/api/health",
]);

/**
 * Origins Clerk will accept a session token from, compared against the token's
 * `azp` claim. Values come only from platform-set `process.env` — never from a
 * request `Host`/`Origin` header, which a caller can forge.
 *
 * This mirrors the portal's hardening so a token minted for a different
 * frontend cannot be replayed against the dashboard.
 */
function getAuthorizedParties(): string[] {
  const parties = new Set<string>();

  // Explicit operator-provided list.
  const configured = process.env.CLERK_AUTHORIZED_PARTIES;
  if (configured) {
    for (const origin of configured.split(/[\s,]+/)) {
      if (origin) parties.add(origin.replace(/\/+$/, ""));
    }
  }

  // The canonical production origin — portal and dashboard share it.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) parties.add(appUrl.replace(/\/+$/, ""));

  // Preview deployments are served from Vercel-generated URLs. These env vars
  // are injected by the platform, not derived from the incoming request, and
  // are trusted only when the platform says this is a preview build.
  if (process.env.VERCEL_ENV === "preview") {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
      if (host) parties.add(`https://${host}`);
    }
  }

  if (process.env.NODE_ENV === "development") {
    parties.add("http://localhost:3000");
  }

  return Array.from(parties);
}

/**
 * Clerk cookies cleared when a session cannot be verified.
 *
 * `__session` carries the JWT itself; the other two are the client-side hints
 * Clerk uses to decide whether it believes a session exists. Clearing the JWT
 * alone leaves those hints behind, and the browser is then told it is signed
 * in while every request is rejected — which is its own kind of loop.
 */
const CLERK_SESSION_COOKIES = ["__session", "__client_uat", "__clerk_db_jwt"];

/**
 * Marks that we have already cleared a bad session for this browser.
 *
 * Without it, an unverifiable cookie that the browser keeps re-presenting
 * would bounce between here and sign-in forever. One reset is a repair; a
 * second means clearing did not help, and continuing to redirect would be a
 * loop rather than a fix.
 */
const RESET_MARKER = "fm_auth_reset";

/**
 * Whether both Clerk keys are present and non-empty.
 *
 * Deliberately duplicated from `hasClerkKeys` in `lib/auth/dashboard-access`,
 * which owns this rule for the request path. That module hashes identifiers
 * with `node:crypto`, and importing it here breaks the build outright — the
 * edge runtime cannot bundle `node:` schemes. Middleware has to stay
 * dependency-free, so the rule is restated in the few lines it takes.
 * `test_dashboard_access.ts` asserts the two copies agree.
 */
function clerkIsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const nonEmpty = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
  return nonEmpty(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && nonEmpty(env.CLERK_SECRET_KEY);
}

/**
 * The response when Clerk cannot start at all.
 *
 * A missing key is not a bad cookie, and must not be treated as one.
 * `clerkMiddleware()` throws `Missing publishableKey` on EVERY request when a
 * key is absent — which the wrapper below does catch, so the zone no longer
 * 500s either way. But routing that case into the session-recovery path would
 * answer the wrong question: it clears cookies that were never the problem,
 * bounces to a portal that considers the visitor signed in and sends them
 * straight back, and then tells them to clear their cookies — advice that
 * cannot help, for a fault that is ours and not theirs.
 *
 * 503 for BOTH pages and API routes, deliberately, rather than the sign-in
 * redirect used for an ordinary signed-out visitor. Without a publishable key
 * no session can be verified, so "you are signed out" would be a claim this
 * code cannot make. An honest, terminal 503 denies access without lying and
 * without looping.
 *
 * It never returns `NextResponse.next()`: a configuration failure must not
 * become an access grant.
 */
function serviceUnavailable(req: NextRequest): NextResponse {
  const headers = { "Cache-Control": "no-store" };
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers });
  }
  return new NextResponse(
    "The FortMark dashboard is temporarily unavailable. Please try again shortly.",
    { status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } }
  );
}

/**
 * Recover from an authentication failure instead of crashing.
 *
 * Clerk throws when it cannot verify the session token it was handed — most
 * commonly a `jwk-kid-mismatch`, where the cookie was minted by a different
 * Clerk instance than the one this deployment's secret key belongs to. That is
 * a foreseeable state: keys get rotated, environments get re-pointed, and a
 * browser can hold a cookie from any of them.
 *
 * Before this, the throw escaped the middleware, and Vercel surfaced it as
 * `MIDDLEWARE_INVOCATION_FAILED` — a hard 500 on EVERY route, including ones
 * that need no session at all. An unverifiable cookie should mean "you are not
 * signed in", never "the dashboard is down".
 *
 * This never widens access: the only outcomes are a signed-out redirect or an
 * error response. No request reaches protected content because of it.
 */
function recoverFromAuthFailure(req: NextRequest): NextResponse {
  // Already tried once for this browser. Clearing did not take, so redirecting
  // again would just loop; say so plainly instead.
  if (req.cookies.get(RESET_MARKER)) {
    return new NextResponse(
      "Your session could not be verified. Please close this tab, clear cookies for this site, and sign in again.",
      { status: 503, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const returnPath = `${req.nextUrl.basePath}${req.nextUrl.pathname}${req.nextUrl.search}`;
  const response = NextResponse.redirect(
    new URL(signInUrl(returnPath), req.nextUrl.origin)
  );

  // Drop the unusable credentials so the retry arrives as a clean anonymous
  // request rather than re-presenting the same rejected token.
  for (const name of CLERK_SESSION_COOKIES) {
    response.cookies.delete({ name, path: "/" });
  }
  response.cookies.set(RESET_MARKER, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    // Long enough to cover the sign-in round trip, short enough that a later
    // genuine failure is treated as new rather than as a repeat.
    maxAge: 120,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

const clerkHandler = clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;

    const { userId } = await auth();
    if (userId) return;

    // API routes get a JSON 401 rather than an HTML redirect, so a client
    // fetch fails loudly instead of silently receiving a sign-in page.
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    // `nextUrl.pathname` excludes the basePath, so rebuild the full path the
    // browser actually requested for the return trip.
    const returnPath = `${req.nextUrl.basePath}${req.nextUrl.pathname}${req.nextUrl.search}`;

    // `signInUrl` falls back to a relative path when NEXT_PUBLIC_APP_URL is
    // unset, and `NextResponse.redirect` rejects relative URLs — which turned
    // "send this visitor to sign in" into a 500 on every dashboard page.
    // Resolving against the request's own origin keeps a misconfigured
    // environment merely degraded rather than unavailable. It never widens
    // access: the destination is still the sign-in route, and the URL is built
    // from the request origin, not from any user-supplied value.
    const destination = new URL(signInUrl(returnPath), req.nextUrl.origin);
    return NextResponse.redirect(destination);
  },
  { authorizedParties: getAuthorizedParties() }
);

/**
 * The exported middleware.
 *
 * Wraps Clerk rather than replacing it, so every authorization rule above is
 * unchanged — this only decides what happens when Clerk cannot run.
 *
 * Two distinct faults, two distinct answers. The configuration check runs
 * FIRST and never reaches Clerk: an absent key is a deployment fault that no
 * visitor can act on, so it gets a terminal 503. The try/catch then covers
 * everything else Clerk can throw — chiefly an unverifiable session token —
 * where clearing the cookie and asking for a fresh sign-in is a real repair.
 * The catch remains the backstop for a configuration fault the check cannot
 * anticipate; it simply no longer has to stand in for the common one.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!clerkIsConfigured()) return serviceUnavailable(req);

  try {
    return await clerkHandler(req, event);
  } catch {
    // Deliberately does not inspect or log the error: Clerk's message embeds
    // the session token's key id and instance identifiers, and this runs on
    // every request. The recovery is the same whatever the cause.
    return recoverFromAuthFailure(req);
  }
}

export const config = {
  matcher: [
    // The zone root. Listed explicitly because a request to exactly the
    // basePath (`/dashboard`, no trailing slash) is not matched by the
    // catch-all pattern below — without this the dashboard home would render
    // without ever consulting the middleware.
    "/",
    // Everything except Next internals and static asset extensions.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|css|js|map)$).*)",
    // Always run for API routes, regardless of the pattern above.
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy path.
    "/__clerk/(.*)",
  ],
};
