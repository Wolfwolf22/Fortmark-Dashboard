import "server-only";
import { and, eq } from "drizzle-orm";
import type { Actor } from "../auth/actor.ts";
import type { Db } from "../db/client.ts";
import { personalWorkspaces } from "../db/schema.ts";

// Personal preferences have no administrator/broker override. The owner is
// always derived from the verified session, never accepted from the caller.
export async function readWorkspace(db: Db, actor: Actor, namespace: string) {
  const [row] = await db.select({ data:personalWorkspaces.data, revision:personalWorkspaces.revision }).from(personalWorkspaces)
    .where(and(eq(personalWorkspaces.ownerUserId,actor.userId),eq(personalWorkspaces.namespace,namespace))).limit(1);
  return row ?? {data:{},revision:0};
}
export async function writeWorkspace(db: Db, actor: Actor, namespace: string, revision: number, data: Record<string,string>) {
  const row = { ownerUserId:actor.userId,namespace,data,revision:revision+1,updatedAt:new Date() };
  // Atomic compare-and-swap prevents an old tab/device from overwriting newer work.
  const result = revision===0
    ? await db.insert(personalWorkspaces).values(row).onConflictDoNothing().returning({revision:personalWorkspaces.revision})
    : await db.update(personalWorkspaces).set({data,revision:revision+1,updatedAt:row.updatedAt})
      .where(and(eq(personalWorkspaces.ownerUserId,actor.userId),eq(personalWorkspaces.namespace,namespace),eq(personalWorkspaces.revision,revision)))
      .returning({revision:personalWorkspaces.revision});
  return result[0] ?? null;
}
