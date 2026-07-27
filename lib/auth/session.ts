/**
 * The auth seam. Mock session today; when the real provider (e.g. Supabase
 * Auth) lands, this file and `middleware.ts` are the only places that change.
 */

export interface Session {
  user: {
    id: string;
    name: string;
    email: string;
    role: "Broker" | "Agent" | "Transaction coordinator" | "Admin";
  };
}

export async function getSession(): Promise<Session | null> {
  // TODO: session check — read and verify the provider session here.
  return {
    user: {
      id: "agent-1",
      name: "Marcus Webb",
      email: "marcus.webb@fortmark.com",
      role: "Broker",
    },
  };
}

export async function signOut(): Promise<void> {
  // TODO: session check — call the provider's sign-out and clear cookies.
}
