"use client";

/**
 * Sign-out through Clerk's supported client method. Clears the session and
 * returns the user to the public portal, so revisiting the dashboard requires
 * authenticating again.
 */
import { useClerk } from "@clerk/nextjs";
import { portalUrl } from "@/lib/routes";

export function SignOutLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { signOut } = useClerk();

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        // `redirectUrl` is an absolute origin we control, never user input.
        void signOut({ redirectUrl: portalUrl() });
      }}
    >
      {children}
    </button>
  );
}
