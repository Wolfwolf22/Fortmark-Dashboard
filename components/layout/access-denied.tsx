import Image from "next/image";
import { assetPath } from "@/lib/routes";
import { SignOutLink } from "@/components/layout/sign-out-link";
import { portalUrl } from "@/lib/routes";

/**
 * Branded terminal state for a signed-in visitor who may not use the
 * dashboard, and for a server whose Clerk configuration is incomplete.
 *
 * Deliberately says nothing about *why* a user is not approved and never
 * echoes a configured value — an operator reads the distinction from the
 * variant, not from leaked configuration.
 */
export function AccessDenied({
  variant,
  email,
}: {
  variant: "unauthorized" | "misconfigured";
  email?: string | null;
}) {
  const misconfigured = variant === "misconfigured";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md text-center">
        <Image
          src={assetPath("/brand/fortmark-logomark-black.png")}
          alt=""
          width={32}
          height={32}
          className="mx-auto mb-8 h-8 w-auto dark:hidden"
        />
        <Image
          src={assetPath("/brand/fortmark-logomark-white.png")}
          alt=""
          width={32}
          height={32}
          className="mx-auto mb-8 hidden h-8 w-auto dark:block"
        />

        <h1 className="text-display text-2xl">
          {misconfigured ? "Dashboard unavailable" : "Access not enabled"}
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {misconfigured ? (
            <>
              The dashboard is not configured for this environment, so it has
              stopped rather than serve unverified data. An administrator needs
              to complete the FortMark access configuration.
            </>
          ) : (
            <>
              Your FortMark sign-in worked, but this account is not enabled for
              the dashboard yet. Ask an administrator to add you.
            </>
          )}
        </p>

        {!misconfigured && email && (
          <p className="mt-6 text-[13px] text-muted-foreground">
            Signed in as <span className="text-foreground">{email}</span>
          </p>
        )}

        <div className="mt-8 flex items-center justify-center gap-3">
          <a
            href={portalUrl()}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Back to FortMark
          </a>
          <SignOutLink className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85">
            Sign out
          </SignOutLink>
        </div>
      </div>
    </main>
  );
}
