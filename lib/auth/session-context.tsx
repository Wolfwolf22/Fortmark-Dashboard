"use client";

import * as React from "react";
import type { Session } from "./session";

/**
 * The authenticated session, handed down from the protected server layout.
 *
 * Client components read the real Clerk-derived identity from here instead of
 * the former mock `getCurrentUser()` adapter. There is no default value: using
 * this outside the protected layout is a programming error, not a silent
 * fallback to an anonymous or synthetic user.
 */
const SessionContext = React.createContext<Session | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: Session;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside the protected dashboard layout");
  }
  return ctx;
}
