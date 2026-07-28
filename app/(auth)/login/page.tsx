import { redirect } from "next/navigation";
import { signInUrlFor, DASHBOARD_BASE_PATH } from "@/lib/auth/config";

/**
 * The dashboard has no sign-in form of its own.
 *
 * fortmark-app at `https://app.fortmark.net/sign-in` is the single sign-in
 * entry point for the whole platform. The former mock form here (email +
 * password + "Continue with SSO", all of which just called `router.push("/")`
 * without authenticating anything) has been removed entirely.
 *
 * Any bookmark or deep link to `/dashboard/login` lands here and is forwarded
 * to the real sign-in, carrying a validated return target.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnBackUrl?: string; redirect_url?: string }>;
}) {
  const params = await searchParams;
  // `signInUrlFor` validates the target and collapses anything outside the
  // dashboard zone to its root, so an open redirect is not possible here.
  redirect(signInUrlFor(params.returnBackUrl ?? params.redirect_url ?? DASHBOARD_BASE_PATH));
}
