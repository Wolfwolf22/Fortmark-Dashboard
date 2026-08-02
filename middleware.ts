import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
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
 * Whether both Clerk keys are present and non-empty.
 *
 * Deliberately duplicated here rather than imported from
 * `lib/auth/dashboard-access`, which is the module that owns this rule for the
 * request path. That module hashes identifiers with `node:crypto`, and pulling
 * it into middleware breaks the build outright — the edge runtime cannot
 * bundle `node:` schemes. Middleware has to stay dependency-free, so the rule
 * is restated in the few lines it takes. `test_dashboard_access.ts` asserts
 * both copies agree.
 */
function clerkIsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const nonEmpty = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
  return nonEmpty(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && nonEmpty(env.CLERK_SECRET_KEY);
}

/**
 * The response when Clerk cannot start.
 *
 * `clerkMiddleware()` throws `Missing publishableKey` on EVERY request when a
 * key is absent, and a throw from middleware becomes
 * MIDDLEWARE_INVOCATION_FAILED — a 500 on every route in the zone, including
 * the ones that should merely redirect. That is exactly what took the
 * dashboard down: the key was absent from the Production scope, so the current
 * build and the previous one failed identically, while Preview — which has the
 * key — was healthy throughout.
 *
 * 503 for BOTH pages and API routes, deliberately, rather than the sign-in
 * redirect used for an ordinary signed-out visitor. Without a publishable key
 * no session can be verified, so "you are signed out" would be a claim this
 * code cannot make — and the portal, which is healthy and already considers
 * the visitor signed in, would redirect straight back and produce a loop.
 * An honest, terminal 503 denies access without lying and without looping.
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
 * Guards Clerk's handler rather than replacing it.
 *
 * The configuration check runs BEFORE the handler is invoked, because the throw
 * happens inside Clerk itself and cannot be caught into a safe response from
 * within the callback. Every other request takes the identical path it did
 * before, so authentication behaviour is unchanged.
 */
export default function middleware(
  req: NextRequest,
  event: Parameters<typeof clerkHandler>[1]
) {
  if (!clerkIsConfigured()) return serviceUnavailable(req);
  return clerkHandler(req, event);
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
