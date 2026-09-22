/**
 * Team roster adapter.
 *
 * The server decides the source (`/api/team`): real dashboard users and their
 * professional profiles, the labelled fixture roster, or not configured. This
 * adapter only reports what it was told — it never falls back to generated
 * colleagues because a request failed.
 */
import { apiPath } from "@/lib/routes";
import type { RosterEntry } from "@/lib/team/roster";
import type { TeamMember } from "../types";
import { getTeam } from "./settings";
import { SubsystemUnavailableError } from "./subsystems";

export type TeamRoster =
  | { source: "db"; viewerPrivileged: boolean; items: RosterEntry[] }
  | { source: "sample"; items: TeamMember[] };

export class TeamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`The team roster could not be read (${status}).`);
    this.name = "TeamError";
    this.status = status;
  }
}

export async function getTeamRoster(): Promise<TeamRoster> {
  const response = await fetch(apiPath("/api/team"), { headers: { Accept: "application/json" } });
  let body: { source?: string; error?: string; viewerPrivileged?: boolean; items?: RosterEntry[] } = {};
  try {
    body = await response.json();
  } catch {
    // Status alone is enough to report the failure honestly.
  }
  if (response.status === 503 && body.error === "not_configured") {
    throw new SubsystemUnavailableError("team");
  }
  if (!response.ok) throw new TeamError(response.status);
  if (body.source === "sample") return { source: "sample", items: await getTeam() };
  if (body.source === "db" && Array.isArray(body.items)) {
    return { source: "db", viewerPrivileged: body.viewerPrivileged === true, items: body.items };
  }
  throw new TeamError(response.status);
}
