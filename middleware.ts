/**
 * Dashboard edge middleware — Clerk-protected, FAIL-CLOSED.
 *
 * This zone is served behind a rewrite from fortmark-app at
 * `https://app.fortmark.net/dashboard`. That rewrite is a routing convenience,
 * NOT a security boundary: the dashboard's own Vercel URL stays directly
 * reachable, so this middleware protects the zone independently.
 *
 * Three outcomes, in order:
 *   1. configuration unusable   → 503, nothing rendered, Clerk never called
 *   2. no session               → 307 to the canonical sign-in carrying a
 *                                 validated return target (401 JSON for APIs)
 *   3. session not on allowlist → 403, enforced in the protected layout and
 *                                 route handlers where the user id is readable
 *
 * `authorizedParties` is pinned to the canonical origin so a session token
 * minted for a different frontend cannot be replayed here. Arbitrary
 * `*.vercel.app` origins are never authorized in production.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  DASHBOARD_BASE_PATH,
  getAuthorizedParties,
  isApproved,
  loadAuthConfig,
  signInUrlFor,
} from "@/lib/auth/config";

/** Everything in the zone is protected except the unauthenticated health probe. */
const isPublicRoute = createRouteMatcher(["/api/health"]);

const UNAVAILABLE_BODY = JSON.stringify({
  error: "auth_configuration_unavailable",
  message: "The dashboard is not correctly configured for authentication.",
});

const FORBIDDEN_JSON = JSON.stringify({
  error: "access_denied",
  message: "This FortMark account is not provisioned for the dashboard.",
});

/**
 * Minimal, self-contained 403 body. Deliberately not a Next page render: a
 * server component cannot set a 403 status without an experimental API, and the
 * status code is the part that matters here. It reveals nothing about the
 * account beyond the fact that it is not provisioned.
 */
const FORBIDDEN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Access denied · FortMark</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#000;color:#fff;font:400 15px/1.6 system-ui,-apple-system,sans-serif}
  main{max-width:28rem;padding:2rem;text-align:center}
  h1{font-size:1.25rem;font-weight:700;margin:0 0 .75rem}
  p{margin:0 0 1.5rem;color:rgba(255,255,255,.6)}
  a{color:#fff;text-decoration:underline;text-underline-offset:3px}
</style></head>
<body><main>
  <h1>Access denied</h1>
  <p>You are signed in, but this FortMark account is not provisioned for the
     dashboard. Access is granted by your broker.</p>
  <a href="https://app.fortmark.net/account">Return to your account</a>
</main></body></html>`;

export default clerkMiddleware(
  async (auth, req) => {
    // 1) Fail closed on unusable configuration — never call Clerk, never render.
    const cfg = await loadAuthConfig();
    if (!cfg.ok) {
      return new NextResponse(UNAVAILABLE_BODY, {
        status: 503,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (isPublicRoute(req)) return;

    // 2) No session → canonical sign-in, carrying where to come back to.
    //    `nextUrl.pathname` already includes the basePath, so it is exactly the
    //    path the browser should return to after authenticating.
    const { userId } = await auth();
    if (!userId) {
      const raw = req.nextUrl.pathname + req.nextUrl.search;
      const returnTo = raw.startsWith(DASHBOARD_BASE_PATH)
        ? raw
        : `${DASHBOARD_BASE_PATH}${raw}`;

      // API callers get a machine-readable 401 rather than an HTML redirect.
      if (req.nextUrl.pathname.includes("/api/")) {
        return new NextResponse(JSON.stringify({ error: "unauthenticated" }), {
          status: 401,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      return NextResponse.redirect(signInUrlFor(returnTo), 307);
    }

    // 3) Approved-user enforcement. A VALID Clerk user who is not on the
    //    allowlist gets a genuine 403 here — never a silent pass-through, and
    //    never a redirect loop back to sign-in (they ARE signed in).
    if (!(await isApproved(cfg.config, userId))) {
      const wantsJson = req.nextUrl.pathname.includes("/api/");
      return new NextResponse(
        wantsJson ? FORBIDDEN_JSON : FORBIDDEN_HTML,
        {
          status: 403,
          headers: {
            "content-type": wantsJson ? "application/json" : "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        }
      );
    }
  },
  { authorizedParties: getAuthorizedParties() }
);

export const config = {
  matcher: [
    // Skip Next internals and static files; everything else is protected.
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/(api|trpc)(.*)",
  ],
};
