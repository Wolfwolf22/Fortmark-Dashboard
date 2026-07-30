import { BentoGrid } from "@/components/home/bento-grid";
import { HomeIdentityCard } from "@/components/home/home-identity-card";
import { getSession } from "@/lib/auth/session";
import { getHomeIdentityCard } from "@/lib/profile/shell";

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
 * allowlist, so reaching here means the caller is approved.
 * `getHomeIdentityCard` still re-checks independently and returns null on any
 * failure, in which case the grid renders without the card rather than erroring.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await getSession();
  const card = session ? await getHomeIdentityCard(session.user) : null;

  return <BentoGrid fixedLead={card ? <HomeIdentityCard data={card} /> : undefined} />;
}
