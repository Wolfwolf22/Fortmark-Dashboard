/**
 * The browser's view of which unimplemented subsystems may show sample data.
 *
 * Every adapter whose domain has no backing service asks this before it
 * answers. In `sample` mode it serves the generated set, which the screens
 * label on sight; in `not_configured` mode it refuses, and the screen says
 * the subsystem is not connected.
 *
 * Refusing matters more than it looks. Returning an empty list instead would
 * be its own falsehood — "you have no messages" and "there is no messaging"
 * are different statements, and only one of them is true here. So the read
 * fails, loudly, and the failure carries the name of the subsystem so the UI
 * can say which one.
 */
import { apiPath } from "@/lib/routes";
import type { Subsystem, SubsystemAvailability, SubsystemMap } from "@/lib/subsystems/config";

export type { Subsystem, SubsystemAvailability };

/** A read refused because the subsystem has no source. */
export class SubsystemUnavailableError extends Error {
  readonly subsystem: Subsystem;
  constructor(subsystem: Subsystem) {
    super(`The ${subsystem} subsystem is not connected in this deployment.`);
    this.name = "SubsystemUnavailableError";
    this.subsystem = subsystem;
  }
}

let mapPromise: Promise<SubsystemMap> | null = null;

/**
 * Asked once per page load. A failure to ask (a signed-out tab, a network
 * blip) is not cached, so the next read tries again rather than inheriting
 * one bad moment for the life of the session.
 */
export function getSubsystemAvailability(): Promise<SubsystemMap> {
  if (!mapPromise) {
    mapPromise = fetch(apiPath("/api/subsystems"), { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`subsystem availability request failed (${response.status})`);
        const body = (await response.json()) as { subsystems: SubsystemMap };
        return body.subsystems;
      })
      .catch((error) => {
        mapPromise = null;
        throw error;
      });
  }
  return mapPromise;
}

/**
 * Let a read proceed, or refuse it.
 *
 * Note which way the unknown falls: if the map cannot be read at all, this
 * throws too. A subsystem is permitted to show generated data only when the
 * server has said so in this session — never because nobody answered.
 */
export async function requireSubsystem(subsystem: Subsystem): Promise<void> {
  let map: SubsystemMap;
  try {
    map = await getSubsystemAvailability();
  } catch {
    throw new SubsystemUnavailableError(subsystem);
  }
  if (map[subsystem] !== "sample") throw new SubsystemUnavailableError(subsystem);
}

/** True when this deployment is in the labelled fixture mode. */
export async function isSampleSubsystem(subsystem: Subsystem): Promise<boolean> {
  try {
    return (await getSubsystemAvailability())[subsystem] === "sample";
  } catch {
    return false;
  }
}
