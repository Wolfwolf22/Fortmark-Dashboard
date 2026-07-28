import { redirect } from "next/navigation";
import { AppShell } from "./app-shell";
import { SessionProvider } from "@/lib/auth/session-context";
import { getSession, AccessDeniedError, AuthConfigurationError } from "@/lib/auth/session";
import { signInUrlFor, DASHBOARD_BASE_PATH } from "@/lib/auth/config";

/**
 * PROTECTED SERVER LAYOUT — defense in depth.
 *
 * The edge middleware already rejects unauthenticated and non-approved callers,
 * and the upstream fortmark-app rewrite is NOT relied on for security at all.
 * This second, independent check runs in the Node runtime so that no page in
 * this group can ever render without an approved Clerk identity, even if the
 * middleware matcher were misconfigured.
 *
 * Rendering is dynamic by necessity: the session is per-request.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session;
  try {
    session = await getSession();
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      // Middleware normally returns a real 403 before we get here. Reaching
      // this branch means the middleware was bypassed — fail closed anyway.
      redirect(`${DASHBOARD_BASE_PATH}/access-denied`);
    }
    if (err instanceof AuthConfigurationError) throw err; // → 500, never a render
    throw err;
  }

  if (!session) redirect(signInUrlFor(DASHBOARD_BASE_PATH));

  return (
    <SessionProvider value={session}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
