/**
 * Agents adapter.
 *
 * There is no agent directory and no production service. The roster and the
 * ranked leaderboard below are generated, so both are refused outside the
 * labelled fixture mode: a named colleague with a dollar figure beside them
 * is a statement about a real person's year.
 *
 * `getAgent` is the exception, and deliberately so. It is a lookup into the
 * sample roster, asked only about rows that came from that roster, and its
 * callers already treat "not found" as "show what the record itself says".
 * Outside fixture mode it finds nobody — which invents nothing, states
 * nothing, and lets a real record's own agent name stand.
 */
import { Agent, AgentProduction, DateRange } from "../types";
import { agents, transactions } from "../mock/db";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";
import { isSampleSubsystem, requireSubsystem } from "./subsystems";

export async function getAgents(): Promise<Agent[]> {
  await requireSubsystem("team");
  await delay(100);
  return [...agents];
}

export async function getAgent(id: string): Promise<Agent | undefined> {
  if (!(await isSampleSubsystem("team"))) return undefined;
  await delay(80);
  return agents.find((a) => a.id === id);
}

/** Ranked production within a period, for the leaderboard and Reports. */
export async function getLeaderboard(range: DateRange): Promise<AgentProduction[]> {
  await requireSubsystem("reports");
  await delay();
  const rows = agents
    .filter((a) => a.role !== "coordinator")
    .map((agent) => {
      const mine = transactions.filter((t) => t.agentId === agent.id);
      const offersMade = mine.filter((t) => inRange(t.contractDate, range)).length;
      const active = mine.filter(
        (t) => t.stage !== "closed" && (inRange(t.contractDate, range) || (t.closeDate ? inRange(t.closeDate, range) : false))
      );
      const closed = mine.filter((t) => t.stage === "closed" && (t.closeDate ? inRange(t.closeDate, range) : false));
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
