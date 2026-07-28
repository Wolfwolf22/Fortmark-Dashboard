# Deployment — Clerk authentication and the FortMark dashboard zone

## Architecture

The dashboard is a **zone** of the FortMark portal, not a separate site.

```
                      https://app.fortmark.net
                                │
        ┌───────────────────────┴────────────────────────┐
        │                                                │
   /  ·  /sign-in  ·  /account                     /dashboard/*
   fortmark-app (Next 16, Tailwind 4)              Fortmark-Dashboard
   Vercel project: fortmark-app                    (Next 15, Tailwind 3)
        │                                                │
        └──────── rewrite: /dashboard/:path* ────────────┘
                  destination: $DASHBOARD_ORIGIN
```

One origin, one Clerk instance. The session cookie is set on
`app.fortmark.net` and forwarded with rewritten requests, so the dashboard
reads the same session — no satellite domain, no cookie copying, and
`authorizedParties` stays a single origin.

### Why not one codebase

`fortmark-app` is Next 16 / React 19.2 / Tailwind v4. The dashboard is Next
15.5 / Tailwind v3 with a design system defined entirely in a Tailwind v3 JS
config (11 colour groups, custom radii, shadows, `text-display`, `text-micro`,
`tabular`, `tailwindcss-animate`) plus 17 Radix packages, recharts, dnd-kit
and cmdk. Merging would have required a Tailwind major and a Next major
migration touching every visual surface, for no user-visible gain. The zone
rewrite delivers the same production URL structure without that risk.

## Environment variables

Values are never committed. See `.env.example` for the authoritative list.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | dev, preview, prod | Client-visible by design |
| `CLERK_SECRET_KEY` | dev, preview, prod | Server-only. Never log or expose |
| `NEXT_PUBLIC_APP_URL` | dev, preview, prod | Canonical origin. Prod: `https://app.fortmark.net` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | optional | Defaults to `/sign-in` |
| `CLERK_AUTHORIZED_PARTIES` | preview, prod | Explicit origins only. Never a wildcard |
| `FORTMARK_ALLOWED_CLERK_USER_IDS` | dev, preview, prod | **Server-only.** Never prefix `NEXT_PUBLIC_` |

On **fortmark-app** additionally:

| Variable | Scope | Notes |
|---|---|---|
| `DASHBOARD_ORIGIN` | dev, preview, prod | Dashboard deployment origin, no trailing slash. Unset ⇒ `/dashboard` 404s rather than misrouting |

Preview and Production must use **separate Clerk instances**. Do not point a
Preview deployment at the production Clerk instance.

## Clerk Dashboard steps (still required)

1. In the **production** Clerk instance, add `https://app.fortmark.net` as an
   allowed origin / redirect URL. The dashboard is served from that same
   origin, so no additional domain is needed.
2. Confirm the sign-in URL is `/sign-in` and that
   `redirect_url` is permitted for same-origin targets — this is what returns
   a user to the deep link they originally requested.
3. Decide the role source. The dashboard reads, in priority order:
   - Clerk **organization role** (`org:admin` maps to Admin), then
   - server-managed `publicMetadata.fortmarkRole`.
   Anything absent or unrecognised resolves to the non-privileged **Member**.
   `unsafeMetadata` is never consulted — it is user-editable.
4. Collect the Clerk user IDs (`user_…`) that should reach the dashboard and
   put them in `FORTMARK_ALLOWED_CLERK_USER_IDS`.

## Vercel steps (still required)

1. Create a Vercel project for `Wolfwolf22/Fortmark-Dashboard` — **one does
   not exist yet.** Do not attach `app.fortmark.net` to it; the domain stays
   on `fortmark-app`.
2. Set the dashboard project's Production Branch, and add the environment
   variables above to Development / Preview / Production separately.
3. On the **fortmark-app** project set `DASHBOARD_ORIGIN` to the dashboard
   deployment origin (e.g. `https://fortmark-dashboard.vercel.app`) per
   environment — Preview should point at a Preview dashboard deployment, not
   Production.
4. Verify `app.fortmark.net` remains attached only to `fortmark-app`. A domain
   must never be attached to two projects.
5. Confirm Production `CLERK_AUTHORIZED_PARTIES` contains only
   `https://app.fortmark.net`. Vercel-generated preview URLs are added
   automatically by the middleware, and only when `VERCEL_ENV=preview`.

## Verification after deploy

```bash
curl -sI https://app.fortmark.net/dashboard            # expect 307 -> /sign-in
curl -sI https://app.fortmark.net/dashboard/listings   # expect 307 with redirect_url
curl -s -X POST https://app.fortmark.net/dashboard/api/chat \
  -H 'content-type: application/json' -d '{"messages":[]}'   # expect 401
```

Then sign in as an approved user and confirm you land on `/dashboard`; sign in
as a non-allowlisted user and confirm the branded access-denied screen.

## MCP boundary

The dashboard and the MCP server (`IDx-Server`, `/api/mcp`) authenticate
**separately**:

- Dashboard: Clerk **browser session** → server layout / route handler.
- MCP: Clerk **OAuth token** → `/api/mcp`, unchanged.

They may share the semantic source `FORTMARK_ALLOWED_CLERK_USER_IDS`, but an
approved browser session is **not** an MCP OAuth token and grants no MCP
access. The dashboard never calls `/api/mcp`, never holds an MCP token, and
never exposes one to the browser. Future dashboard→FortMark data access must
go: browser → Clerk session → authenticated Next route/server action →
internal service. Keep `/api/mcp` OAuth-only.

## Rollback

The dashboard zone is additive. To disable it without redeploying the
dashboard:

1. Remove `DASHBOARD_ORIGIN` from the **fortmark-app** project and redeploy.
   `/dashboard` returns 404; the portal, sign-in, account and OAuth consent
   are untouched.
2. To also restore the previous post-sign-in destination, revert the
   `fallbackRedirectUrl` change in `app/sign-in/[[...sign-in]]/page.tsx` back
   to `/account`.

To roll the dashboard itself back, redeploy the previous dashboard build or
promote a prior deployment; the portal needs no change because it addresses
the dashboard by origin, not by build.
