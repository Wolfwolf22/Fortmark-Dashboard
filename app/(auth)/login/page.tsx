import { redirect } from "next/navigation";
import { BASE_PATH, signInUrl } from "@/lib/routes";

/**
 * The dashboard has no sign-in form of its own.
 *
 * FortMark authenticates once, in the portal zone, through Clerk. This route
 * exists only so stale bookmarks to the old placeholder login page land
 * somewhere correct instead of 404ing — it forwards to the real Clerk
 * sign-in and asks to come back to the dashboard afterwards.
 */
export const dynamic = "force-dynamic";

export default function LoginPage(): never {
  redirect(signInUrl(BASE_PATH));
}
