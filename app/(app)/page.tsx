import { BentoGrid } from "@/components/home/bento-grid";
import { HomeHero } from "@/components/home/home-hero";
import { HomeMetricsProvider } from "@/components/home/metrics-provider";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getHomeIdentityCard, shouldRedirectToOnboarding } from "@/lib/profile/shell";
import { ROUTES } from "@/lib/routes";
import { ONBOARDING_DEFERRAL_COOKIE, isDeferred } from "@/lib/profile/deferral";

/**
 * Home — the Welcome hero, the daily brief and the reorderable grid, all
 * reading one metrics request.
 *
 * The greeting is resolved on the server by the same projection the profile
 * route serves (`getHomeIdentityCard` → `greetingNameFor`), and only the two
 * strings the hero prints cross to the client: the first name and the role
 * label. The licence, NRDS id and contact details the identity card used to
 * carry are no longer in this page's payload at all — the full identity lives
 * in the account drawer in the top bar.
 *
 * `getHomeIdentityCard` never returns null on an approved request (it falls
 * back to a session-only projection), so the greeting degrades to the Clerk
 * first name, then to a plain "Welcome", and never to an email.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await getSession();

  // First approved login opens the wizard automatically.
  //
  // Done HERE, in a server component, rather than in middleware: the decision
  // needs the profile row, and middleware must never touch the database.
  //
  // "Complete later" sets a session cookie, so the choice survives navigation
  // rather than suppressing a single redirect. A query parameter could not do
  // this: navigate away and back and the wizard forced itself open again.
  //
  // The cookie authorizes nothing. Every other condition — session, allowlist,
  // both flags, a reachable database, incomplete onboarding — is still
  // required, and the Home card keeps its setup callout, so the prompt is
  // deferred rather than lost.
  const jar = await cookies();
  const deferred = isDeferred(jar.get(ONBOARDING_DEFERRAL_COOKIE)?.value);
  if (session && !deferred && (await shouldRedirectToOnboarding(session.user))) {
    redirect(ROUTES.onboarding);
  }
  // `session` is non-null here in practice: the enclosing layout redirects an
  // anonymous visitor before this renders.
  const card = session ? await getHomeIdentityCard(session.user) : null;

  return (
    <HomeMetricsProvider>
      <HomeHero greetingName={card?.greetingName ?? null} roleLabel={card?.roleLabel ?? null} />
      <BentoGrid />
    </HomeMetricsProvider>
  );
}
