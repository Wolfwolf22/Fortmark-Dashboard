import "server-only";

/**
 * Which subsystems have no backing service, and what they are allowed to do
 * about it.
 *
 * FortMark ships several screens whose domain has never been implemented:
 * there is no calendar provider, no document store, no messaging backend, no
 * notification service, no market feed, no agent directory and no reporting
 * warehouse. Each of them was built against a generator, and for a long time
 * that generator answered in every environment — so a deployment with no
 * integrations at all still showed appointments, contracts, message threads
 * and a projected GCI, none of which described anything.
 *
 * That is the failure this module exists to prevent. A subsystem with no
 * source has exactly two honest behaviours:
 *
 *   `sample`          — the explicit fixture mode, which the screens label.
 *   `not_configured`  — say so. Never a figure, never a name, never a zero.
 *
 * The rule is deliberately the same one the listings domain already follows
 * (`lib/mls/config.ts`), and it is driven by the fixture flag that already
 * exists rather than by nine new environment variables: `SAMPLE_DASHBOARD_ENABLED`
 * is the one sanctioned way a fabricated operational fact may reach a screen,
 * and this widens its scope from Home's figures to every generated domain.
 * Production leaves it unset, so Production gets no fiction at all.
 */
import { sampleDashboardEnabled, type EnvLike } from "../flags.ts";

/**
 * The domains that have no real source yet.
 *
 * Listings is absent on purpose: it has a real MLS path and owns its own
 * three-state availability. Contacts, transactions and the Home metrics are
 * absent for the same reason — they are real.
 */
export const UNBACKED_SUBSYSTEMS = [
  "calendar",
  "documents",
  "messages",
  "notifications",
  "market",
  "team",
  "brokerage",
  "integrations",
  "reports",
] as const;

export type Subsystem = (typeof UNBACKED_SUBSYSTEMS)[number];

/** What a screen may do with a subsystem that has no service behind it. */
export type SubsystemAvailability = "sample" | "not_configured";

export type SubsystemMap = Record<Subsystem, SubsystemAvailability>;

/**
 * The map the browser is given.
 *
 * One decision for all of them, because they share one cause: none of these
 * domains is implemented, and the only question is whether this deployment
 * has asked for the demonstration set by name.
 */
export function subsystemAvailability(env: EnvLike = process.env): SubsystemMap {
  const state: SubsystemAvailability = sampleDashboardEnabled(env) ? "sample" : "not_configured";
  return Object.fromEntries(UNBACKED_SUBSYSTEMS.map((key) => [key, state])) as SubsystemMap;
}
