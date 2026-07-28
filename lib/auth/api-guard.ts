/**
 * Route-handler auth guard — defense in depth for API routes.
 *
 * The edge middleware already returns 401/403 for these paths. This second
 * check runs in the route's own runtime so an API can never serve data if the
 * middleware matcher were changed or bypassed.
 *
 * Returns `null` when the caller is authenticated AND approved; otherwise a
 * ready-to-return Response with the correct status.
 */
import { auth } from "@clerk/nextjs/server";
import { isApproved, loadAuthConfig } from "./config";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function guardApiRoute(): Promise<Response | null> {
  const cfg = await loadAuthConfig();
  if (!cfg.ok) {
    // Fail closed. The coarse reason is safe to return; it names no value.
    return json(503, { error: "auth_configuration_unavailable" });
  }

  const { userId } = await auth();
  if (!userId) return json(401, { error: "unauthenticated" });

  if (!(await isApproved(cfg.config, userId))) {
    return json(403, {
      error: "access_denied",
      message: "This FortMark account is not provisioned for the dashboard.",
    });
  }
  return null;
}
