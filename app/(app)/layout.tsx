/**
 * Server-protected dashboard layout.
 *
 * Authentication is enforced twice on purpose: `middleware.ts` turns away
 * anonymous requests at the edge, and this layout re-checks on the server
 * next to the data it guards. Because the check happens before any shell
 * markup is returned, an unauthorized visitor never receives a frame of
 * dashboard content to flash.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AccessDenied } from "@/components/layout/access-denied";
import { AppShell } from "@/components/layout/app-shell";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";
import { getSession, toPublicUser } from "@/lib/auth/session";
import { BASE_PATH, isSafeReturnPath, signInUrl } from "@/lib/routes";

/**
 * Identity is per-request, so nothing in this subtree may be statically
 * generated or shared between users.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    // Send the visitor back to where they were headed after signing in.
    // Next strips the basePath from middleware-visible paths, so rebuild it.
    const hdrs = await headers();
    const requested = hdrs.get("x-invoke-path") ?? hdrs.get("x-matched-path");
    const returnPath =
      requested && isSafeReturnPath(requested)
        ? requested.startsWith(BASE_PATH)
          ? requested
          : `${BASE_PATH}${requested}`
        : BASE_PATH;
    redirect(signInUrl(returnPath));
  }

  const decision = decideAccess(session.user.id);
  if (!decision.ok) {
    // A misconfigured server is not the visitor's fault and must not read as
    // "you are not allowed" — the two cases get different copy, and neither
    // reveals any configured value.
    return (
      <AccessDenied
        variant={isConfigFailure(decision.reason) ? "misconfigured" : "unauthorized"}
        email={session.user.email}
      />
    );
  }

  return <AppShell user={toPublicUser(session.user)}>{children}</AppShell>;
}
