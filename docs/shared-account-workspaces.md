# Shared FortMark account workspaces

Production is served through the existing FortMark portal at `/competitive-edge` alongside `/dashboard`. The portal protects both zones using its existing Clerk session. Competitive Edge independently asks the fixed Dashboard session endpoint to validate the cookie, approved-user access, and active database identity before every protected request. User IDs or roles from request headers are never accepted.

Dashboard stores personal definitions in `personal_workspaces`, keyed by verified owner ID and namespace. There is no administrator ownership bypass. Each write uses an expected revision and expected account identity; stale tabs cannot overwrite newer work or write after switching users. Cloud writes require same-origin JSON. The strict persisted contract excludes MLS listings, photos, contacts, and county owner records.

Dashboard layout and notification preferences sync to the account. Competitive Edge saved territories, map views, campaign tasks/plans/results, selected folio references, and logo display choices sync separately. AI conversation history stays browser-local but is namespaced by account. Legacy unowned browser saves are retained and are not automatically imported into an account. Unsaved network failures remain visible; users can retry without losing their draft.

Production configuration on Competitive Edge: `FORTMARK_DASHBOARD_SSO=true`, `NEXT_PUBLIC_FORTMARK_SSO=true`, `NEXT_PUBLIC_APP_BASE_PATH=/competitive-edge`, and the existing FortMark Clerk **publishable** key. The portal uses `COMPETITIVE_EDGE_ORIGIN=https://fm-competitive-edge.vercel.app`. No Clerk secret is copied to Competitive Edge. Dashboard's narrowly scoped setup flag creates the additive workspace table using its existing database connection.

Deployment protection must be replaced by this verified application gate only after the Dashboard session endpoint and portal zone are deployed. Older deployments retain their Vercel protection. Do not enable the old private-Vercel-only production path on a deployment without Vercel protection.

Validation: owner-scoped SQL and strict contracts; two-account storage isolation; stale revision/account-switch rejection; offline retry; late-response disposal; no unauthenticated fallback; fixed upstream origin; unchanged brokerage permission checks. Live verification covers the canonical portal launch, personal save/reopen, map assets/API requests, and signed-out denial.
`nProduction sets CLERK_DISABLE_AUTO_PROXY=true, as do the portal and Competitive Edge. This keeps session renewal on the existing clerk.fortmark.net CNAME instead of deriving an unconfigured proxy from the Vercel deployment hostname.
