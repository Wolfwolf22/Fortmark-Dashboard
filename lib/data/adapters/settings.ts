/**
 * Settings adapter. Mock-backed today; swap the bodies for the account
 * service and the UI is untouched.
 */
import { BrokerageProfile, IntegrationStatus, TeamMember } from "../types";
import { agents, brokerage } from "../mock/db";
import { delay } from "./latency";

/**
 * There is deliberately no `getCurrentUser()` here.
 *
 * The signed-in identity comes from Clerk via `getSession()`
 * (`lib/auth/session.ts`) and reaches client components through
 * `useSessionUser()`. Re-adding a mock identity to this adapter would let
 * placeholder account data render as the authenticated user again.
 *
 * `getTeam()` below is brokerage roster data, not identity.
 */
export async function getTeam(): Promise<TeamMember[]> {
  await delay();
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    role:
      a.role === "broker"
        ? "Broker"
        : a.role === "coordinator"
          ? "Transaction coordinator"
          : "Agent",
    status: "active" as const,
  }));
}

export async function getBrokerage(): Promise<BrokerageProfile> {
  await delay(100);
  return { ...brokerage };
}

export async function getIntegrations(): Promise<IntegrationStatus[]> {
  await delay(100);
  return [
    {
      id: "mls",
      name: "MLS",
      description: "Beaches MLS listing sync and media",
      connected: false,
    },
    {
      id: "gmail",
      name: "Gmail",
      description: "Send and log client email from the workspace",
      connected: false,
    },
    {
      id: "calendar",
      name: "Calendar",
      description: "Two-way sync for showings and deadlines",
      connected: false,
    },
  ];
}
