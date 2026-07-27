/**
 * Agents adapter. Mock-backed today; swap the bodies for the identity /
 * production service and the UI is untouched.
 */
import { Agent, AgentProduction, DateRange } from "../types";
import { agents, transactions } from "../mock/db";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";

export async function getAgents(): Promise<Agent[]> {
  await delay(100);
  return [...agents];
}

export async function getAgent(id: string): Promise<Agent | undefined> {
  await delay(80);
  return agents.find((a) => a.id === id);
}

/** Ranked production within a period, for the leaderboard and Reports. */
export async function getLeaderboard(range: DateRange): Promise<AgentProduction[]> {
  await delay();
  const rows = agents
    .filter((a) => a.role !== "coordinator")
    .map((agent) => {
      const mine = transactions.filter((t) => t.agentId === agent.id);
      const offersMade = mine.filter((t) => inRange(t.contractDate, range)).length;
      const active = mine.filter(
        (t) => t.stage !== "closed" && (inRange(t.contractDate, range) || inRange(t.closeDate, range))
      );
      const closed = mine.filter((t) => t.stage === "closed" && inRange(t.closeDate, range));
      return {
        agentId: agent.id,
        name: agent.name,
        offersMade,
        volume: active.reduce((sum, t) => sum + t.contractPrice, 0),
        dealsClosed: closed.length,
        closedDollars: closed.reduce((sum, t) => sum + t.contractPrice, 0),
      };
    });
  return rows.sort(
    (a, b) => b.closedDollars + b.volume - (a.closedDollars + a.volume)
  );
}
