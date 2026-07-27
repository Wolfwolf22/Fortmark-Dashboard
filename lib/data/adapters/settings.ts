/**
 * Settings adapter. Mock-backed today; swap the bodies for the account
 * service and the UI is untouched.
 */
import { BrokerageProfile, IntegrationStatus, TeamMember } from "../types";
import { agents, brokerage, currentUser } from "../mock/db";
import { delay } from "./latency";

export async function getCurrentUser() {
  await delay(80);
  return { ...currentUser };
}

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
