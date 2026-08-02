import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/profile/onboarding-wizard";
import { getSession } from "@/lib/auth/session";
import { professionalProfileUiEnabled } from "@/lib/flags";
import { onboardingContext } from "@/lib/profile/shell";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Set up your FortMark profile",
};

/** Per-user, and never worth caching. */
export const dynamic = "force-dynamic";

/**
 * The onboarding wizard route, at `/dashboard/onboarding`.
 *
 * A real, directly addressable, refresh-safe page rather than a modal that
 * only exists on top of Home. Everything it needs is resolved server-side, so
 * a reload lands on the same step with the same values.
 *
 * Access is already settled before this runs: the middleware requires a
 * session, and `onboardingContext` re-checks the allowlist through the same
 * `syncCurrentUser` path every other profile read uses. No database call
 * happens in middleware.
 */
export default async function OnboardingPage() {
  const session = await getSession();
  // The middleware redirects anonymous requests, so this is belt-and-braces
  // for a direct render rather than the primary gate.
  if (!session) redirect(ROUTES.home);

  // Optional chrome is off: there is nothing to set up, so this route should
  // not exist as far as the user is concerned.
  if (!professionalProfileUiEnabled()) redirect(ROUTES.home);

  const context = await onboardingContext(session.user);

  // Database unreachable, not allowlisted for profile rows, or already
  // finished — all land back on the dashboard rather than on a wizard that
  // cannot save. Finishing must not be re-openable by URL.
  if (!context.available || context.complete) redirect(ROUTES.home);

  return (
    <div className="py-2">
      <OnboardingWizard
        steps={context.steps}
        initialStep={context.resumeStep}
        values={context.values}
        accountEmail={context.accountEmail}
        role={context.role}
      />
    </div>
  );
}
