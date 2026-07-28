"use client";

/**
 * Carries the server-resolved identity down to client components.
 *
 * The value is produced by `getSession()` on the server and stripped of the
 * Clerk user id (`toPublicUser`) before it crosses the boundary, so no raw
 * identifier reaches the browser. Client components read identity from here
 * rather than fetching it, which keeps the shell free of an identity flash.
 */
import * as React from "react";
import type { PublicSessionUser } from "@/lib/auth/session";

const SessionUserContext = React.createContext<PublicSessionUser | null>(null);

export function SessionUserProvider({
  user,
  children,
}: {
  user: PublicSessionUser;
  children: React.ReactNode;
}) {
  // The object is stable for the lifetime of a server render; memoise so
  // consumers do not re-render on unrelated shell state changes.
  const value = React.useMemo(
    () => user,
    [user.name, user.email, user.imageUrl, user.role] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <SessionUserContext.Provider value={value}>
      {children}
    </SessionUserContext.Provider>
  );
}

/** The signed-in user. Throws if used outside the authenticated shell. */
export function useSessionUser(): PublicSessionUser {
  const user = React.useContext(SessionUserContext);
  if (!user) {
    throw new Error("useSessionUser must be used inside the authenticated shell");
  }
  return user;
}
