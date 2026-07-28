import Link from "next/link";
import { CANONICAL_ORIGIN } from "@/lib/auth/config";

export const metadata = { title: "Access denied" };

/**
 * Fallback access-denied view.
 *
 * The edge middleware returns a genuine 403 for a signed-in but non-approved
 * user, so this page is only reached if the middleware were bypassed. It exists
 * so the failure mode is still a clear denial rather than a broken render.
 */
export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold">Access denied</h1>
        <p className="mt-3 text-sm text-white/60">
          You are signed in, but this FortMark account is not provisioned for the
          dashboard. Access is granted by your broker.
        </p>
        <Link
          href={`${CANONICAL_ORIGIN}/account`}
          className="mt-8 inline-block text-sm underline underline-offset-4"
        >
          Return to your account
        </Link>
      </div>
    </main>
  );
}
