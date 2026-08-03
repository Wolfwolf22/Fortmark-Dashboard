/**
 * "Complete later" — the session-scoped onboarding deferral.
 *
 * A query parameter suppressed exactly one redirect: navigate away and back
 * and the wizard forced itself open again. This is a cookie instead, so the
 * choice survives navigation for as long as the browser session lasts.
 *
 * What this cookie is NOT:
 *
 *   - it is not authentication and not authorization
 *   - it does not identify anyone: the value is a fixed version marker, so two
 *     users' cookies are byte-identical and it carries no Clerk id, no email
 *     and no profile data
 *   - it cannot open anything, only suppress an automatic redirect
 *
 * The only decision it participates in is "should Home push this user into the
 * wizard on its own", and that decision already required a valid session, an
 * allowlisted user, both flags, a reachable database and incomplete
 * onboarding. Presenting the cookie without those changes nothing.
 */

/** No user data in the name and none in the value. */
export const ONBOARDING_DEFERRAL_COOKIE = "fm_onboarding_deferred";

/**
 * A version marker, not a token.
 *
 * Bumping it invalidates every outstanding deferral at once, which is what we
 * want if the wizard changes materially enough to be worth re-prompting.
 */
export const ONBOARDING_DEFERRAL_VALUE = "v1";

/**
 * Scoped to the dashboard zone rather than the whole origin.
 *
 * `app.fortmark.net` serves the portal at `/` and this app under `/dashboard`,
 * so a root-scoped cookie would be sent on every portal request too. There is
 * no reason for the portal to ever see it.
 */
export const ONBOARDING_DEFERRAL_PATH = "/dashboard";

export interface DeferralCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  /** Omitted on purpose — a session cookie, cleared when the browser closes. */
  maxAge?: number;
}

/**
 * Options for setting the deferral.
 *
 * `httpOnly` because no client code has any reason to read it, and a redirect
 * decision made on the server should not be steerable from the document.
 * `sameSite: "lax"` so a cross-site POST cannot set or rely on it.
 * `secure` everywhere except local development, where there is no HTTPS.
 *
 * Deliberately a SESSION cookie with no `maxAge`: "later" should mean "not
 * right now", not "not for a week". A new browser session prompts again,
 * because the user has not finished and still needs to.
 */
export function deferralCookieOptions(env: {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
} = process.env): DeferralCookieOptions {
  const isLocal = env.NODE_ENV === "development" && !env.VERCEL_ENV;
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: !isLocal,
    path: ONBOARDING_DEFERRAL_PATH,
  };
}

/** Whether a cookie value represents a live deferral for this wizard version. */
export function isDeferred(value: string | null | undefined): boolean {
  return value === ONBOARDING_DEFERRAL_VALUE;
}
