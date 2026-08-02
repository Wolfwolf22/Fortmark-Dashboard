import { BentoGrid } from "@/components/home/bento-grid";
import { HomeIdentityCard } from "@/components/home/home-identity-card";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getHomeIdentityCard, shouldRedirectToOnboarding } from "@/lib/profile/shell";
import { ROUTES } from "@/lib/routes";

/**
 * Home — the permanent identity card plus the reorderable bento grid. Title
 * comes from the top bar.
 *
 * A server component so the identity card is built per request and handed
 * straight to the card. That keeps the licence number, NRDS id and contact
 * shortcuts out of the global client stores: they exist only in this page's
 * payload, for the user who requested it.
 *
 * The layout enclosing this route already enforced authentication and the
 * allowlist, so reaching here means the caller is approved — and therefore the
 * card is owed unconditionally. `getHomeIdentityCard` never returns null; on any
 * database or flag failure it returns a session-only projection, so the card is
 * always the first grid cell and can never silently disappear.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();

  // First approved login opens the wizard automatically.
  //
  // Done HERE, in a server component, rather than in middleware: the decision
  // needs the profile row, and middleware must never touch the database.
  //
  // `?setup=later` is the escape hatch. "Complete later" returns to Home with
  // it set, so the user is not bounced straight back into the wizard they just
  // left — which is what a naive redirect-on-incomplete would do on every
  // single navigation. Onboarding stays incomplete, and the Home card keeps
  // showing its setup callout, so the prompt is not lost, only not forced.
  const params = searchParams ? await searchParams : undefined;
  const deferred = params?.setup === "later";
  if (session && !deferred && (await shouldRedirectToOnboarding(session.user))) {
    redirect(ROUTES.onboarding);
  }
  // `session` is non-null here in practice: the enclosing layout redirects an
  // anonymous visitor before this renders. The guard is belt-and-braces, and it
  // is the ONLY branch that can omit the card.
  const card = session ? await getHomeIdentityCard(session.user) : null;

  return <BentoGrid fixedLead={card ? <HomeIdentityCard data={card} /> : undefined} />;
}
