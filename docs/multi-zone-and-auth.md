# Dashboard — multi-zone routing and Clerk authentication

## What this app is

The `/dashboard` **zone** of `https://app.fortmark.net`. It stays a separate
Vercel project on **Next 15 + Tailwind v3** — deliberately NOT migrated to the
Next 16 / Tailwind v4 stack that `fortmark-app` runs — so the two ship on
independent cadences while users see one hostname.

```
https://app.fortmark.net/dashboard        ← canonical
   │
   └─ fortmark-app rewrites /dashboard{,/:path*}
        └─ this project (basePath: "/dashboard")
```

## basePath

`next.config.ts` sets `basePath: "/dashboard"`. Next then prefixes the router,
`next/link`, `next/image`, route handlers and `_next/*` automatically — verified
in the build: `routes-manifest.json` reports `basePath: "/dashboard"`, prerendered
HTML references `/dashboard/_next/static/...`, and the middleware matcher compiles
to `^\/dashboard...`.

Next does **not** prefix hand-written URL strings. Those go through
`lib/base-path.ts`:

| Use | Helper |
| --- | --- |
| `public/` asset in a raw `<img src>` / metadata icon | `assetPath("/brand/x.png")` |
| in-zone `fetch()` target | `apiPath("/api/chat")` |

Fixed at conversion time: three `<img src="/brand/…">` in `nav-rail.tsx` and the
root layout's favicon, plus `fetch("/api/chat")` in `lib/ai/client.ts`.

## Security — the rewrite is NOT the boundary

The dashboard's own Vercel URL stays directly reachable, so this zone
authenticates every request itself. Three independent layers:

1. **Edge middleware** (`middleware.ts`) — Clerk, with `authorizedParties`
   pinned to the canonical origin.
2. **Protected server layout** (`app/(app)/layout.tsx`) — a server component
   that re-checks the session in the Node runtime before any page renders.
3. **Route-handler guard** (`lib/auth/api-guard.ts`) — every API route
   re-checks independently.

### Decision table

| Condition | Result |
| --- | --- |
| Clerk keys or allowlist missing/malformed | **503**, Clerk never called, nothing rendered |
| No session, page request | **307** → `https://app.fortmark.net/sign-in?redirect_url=…` |
| No session, API request | **401** JSON (never an HTML redirect) |
| Valid session, **not** on the allowlist | **403** access denied (not a sign-in loop) |
| Valid session, on the allowlist | allowed |

### Fail-closed configuration

`lib/auth/config.ts` mirrors the model already proven in the FortMark MCP
server. All three are required; any one missing or malformed fails closed:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
FORTMARK_DASHBOARD_ALLOWED_CLERK_USER_IDS
```

Allowlist format: a JSON array of strings, or a comma/whitespace-separated
list. Every entry must match `^user_[A-Za-z0-9]{8,}$`; max 64; **one** malformed
entry fails the whole config rather than being silently dropped. Only SHA-256
digests are retained — a raw Clerk user id is never stored or logged.
Digests use Web Crypto so the module runs identically on the edge and in Node.

### authorizedParties

Production authorizes **exactly one** origin, `https://app.fortmark.net`.
Platform-injected `VERCEL_URL` / `VERCEL_BRANCH_URL` are added **only** when
`VERCEL_ENV === "preview"`. No `*.vercel.app` origin is ever authorized in
production, and no value is ever taken from a request `Host`/`Origin` header.

### Open-redirect protection

`safeReturnPath()` accepts only a same-origin path inside `/dashboard`.
Absolute URLs, protocol-relative URLs, `javascript:`, backslash tricks, `..`
traversal and paths outside the zone all collapse to `/dashboard`.

## Identity

The mock "Marcus Webb" session, the fake login form and the stub logout are
gone:

| Was | Now |
| --- | --- |
| `getSession()` returning a hardcoded user | real Clerk `auth()` + `currentUser()`, allowlist-checked |
| `signOut()` no-op stub | `useClerk().signOut({ redirectUrl })` — revokes the session, clears cookies |
| `/login` form that just `router.push("/")` | server redirect to the canonical `/sign-in` |
| `getCurrentUser()` mock adapter in the user menu | `useSession()`, fed by the protected server layout |

Role comes from Clerk `publicMetadata.role`, defaulting to the **least**
privileged (`Agent`). It is never inferred from an email or a name. The display
name falls back to a generic `"FortMark user"` — never a fabricated person.

## MCP boundary

The dashboard does not reference `/api/mcp`, does not hold an MCP token and
makes no client-side call to the MCP endpoint. A test asserts this by scanning
every `.ts`/`.tsx` file, and also asserts that no `"use client"` module reads a
non-`NEXT_PUBLIC_` env var.

## Canonical origin

`app.fortmark.net/dashboard` is canonical. The raw deployment URL is
discouraged: `X-Robots-Tag: noindex, nofollow` on every response, `robots` metadata
set, and both sign-in and sign-out use absolute canonical URLs so a user who
arrives on the raw URL is returned to `app.fortmark.net`.

## Tests

`npm test` — 77 deterministic assertions, no Clerk credentials required.
Covers the fail-closed matrix, allowlist strictness, approved vs unapproved,
`authorizedParties`, open-redirect blocking, basePath helpers, identity mapping,
the middleware decision table (anonymous redirect, deep link, API 401, approved
access, unapproved 403, nested refresh, static assets) and the MCP boundary.

Five cases genuinely need a deployed Clerk environment and are reported as
`REQUIRES LIVE CLERK` rather than counted as passes — see the summary line.
