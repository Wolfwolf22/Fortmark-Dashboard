import { hasClerkKeys } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe.
 *
 * Reports only whether auth is CONFIGURED — never a key, never a user, never
 * whether any particular account exists. Used to distinguish "the zone is
 * misconfigured" from "the zone is protected and you are not signed in".
 */
export function GET() {
  return new Response(
    JSON.stringify({ ok: true, auth_configured: hasClerkKeys() }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}
