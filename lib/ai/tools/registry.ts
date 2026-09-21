import "server-only";

/**
 * The FortMark tool registry.
 *
 * Every tool in this file is a thin wrapper over a domain service the
 * application already uses. There is no AI-only query, no AI-only service, no
 * second CRM and no direct table access: `get_contact` runs the same
 * `getContact` the contact drawer runs, `search_entities` runs the same
 * providers ⌘K runs, `get_business_summary` runs the same `brokerageMetrics`
 * the Home screen renders. If an agent cannot see a record on a screen, no
 * amount of asking gets it out of here, because the predicate that would have
 * to be defeated is the one the screen already depends on.
 *
 * Scope is resolved from the verified Clerk user id on every call. No tool
 * takes a brokerage, an agent, a role, a tenant or an "on behalf of" argument;
 * none of them has a field for one. An assignment or ownership filter the
 * model might want is the actor's, and the actor is the session's.
 *
 * Every tool here either reads or proposes. Nothing here changes a record.
 *
 * `prepare_contact_followup` is the single exception to "reads only", and it
 * is a narrow one: it writes a row to `ai_prepared_actions` describing a
 * change that has not happened. The contact is untouched. Committing that
 * proposal takes a human pressing a button, which calls a route the model has
 * never been told exists and cannot name, and which re-reads and re-authorizes
 * everything the proposal assumed. There is no execute tool, no confirm tool
 * and no "apply" argument anywhere in this file — saying "yes" to the model
 * accomplishes nothing, because the model has nothing to say yes with.
 */
import { z } from "zod";
import { resolveActor, type Actor } from "../../auth/actor.ts";
import type { Db } from "../../db/client.ts";
import {
  aiActionsEnabled,
  contactsDatabaseEnabled,
  transactionsDatabaseEnabled,
  type EnvLike,
} from "../../flags.ts";
import { getContact, listContacts } from "../../contacts/service.ts";
import { getTransaction, listTransactions } from "../../transactions/service.ts";
import { contactActivity, contactAttention } from "../../contacts/metrics.ts";
import { transactionActivity, transactionAttention } from "../../transactions/metrics.ts";
import { brokerageMetrics } from "../../metrics/service.ts";
import { search } from "../../search/service.ts";
import { prepareFollowup } from "../actions/service.ts";
import { ALL_STAGES } from "../../transactions/stages.ts";
import { SIDES } from "../../transactions/filters.ts";
import { ALL_CONTACT_STAGES } from "../../contacts/stages.ts";
import type { ActivityItem, AttentionItem } from "../../metrics/types.ts";
import {
  activityItem,
  attentionItem,
  businessSummary,
  contactDetail,
  contactSummary,
  transactionDetail,
  transactionSummary,
} from "./dto.ts";
import {
  fail,
  ok,
  TOOL_LIMITS,
  type FortmarkTool,
  type ToolContext,
  type ToolEffect,
  type ToolOutcome,
} from "./types.ts";

// --- Schema plumbing ---------------------------------------------------------

/**
 * One zod schema becomes both halves of a tool's contract: the JSON Schema the
 * provider is given, and the parser the returned arguments must survive. They
 * cannot drift, because they are the same object.
 */
function defineTool<S extends z.ZodType, R>(
  spec: {
    name: string;
    /** Omitted means `read`. A proposing tool has to say so out loud. */
    effect?: ToolEffect;
    description: string;
    schema: S;
    run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutcome<R>>;
  }
): FortmarkTool<z.output<S>, R> {
  const json = z.toJSONSchema(spec.schema, { io: "input" }) as Record<string, unknown>;
  // `$schema` is metadata about the document, not about the arguments.
  delete json.$schema;
  return {
    name: spec.name,
    effect: spec.effect ?? "read",
    description: spec.description,
    inputSchema: json,
    parse: (input) => {
      const parsed = spec.schema.safeParse(input ?? {});
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
    },
    run: spec.run,
  };
}

const rowLimit = z
  .number()
  .int()
  .min(1)
  .max(TOOL_LIMITS.maxRows)
  .optional()
  .describe(`How many rows to return. Default ${TOOL_LIMITS.defaultRows}.`);

/** Record ids are opaque to the model: it only ever echoes one it was given. */
const recordId = z.string().min(1).max(64);

// --- Domain access -----------------------------------------------------------

type DomainCtx = { actor: Actor; db: Db };
type Domain =
  | { ok: true; ctx: DomainCtx }
  | { ok: false; error: "not_configured" | "not_permitted" | "unavailable" };

/**
 * Resolve one domain for this caller, or say why it cannot be resolved.
 *
 * The three refusals are kept apart all the way to the model: a deployment
 * with contacts switched off, a user whose brokerage profile has not synced,
 * and a database that could not be reached are three different sentences, and
 * none of them is "you have no contacts".
 */
async function domain(ctx: ToolContext, enabled: boolean): Promise<Domain> {
  const resolved = await resolveActor(ctx.clerkUserId, enabled);
  if (resolved.ok) return { ok: true, ctx: { actor: resolved.actor, db: resolved.db } };
  if (resolved.reason === "disabled") return { ok: false, error: "not_configured" };
  if (resolved.reason === "no_identity") return { ok: false, error: "not_permitted" };
  return { ok: false, error: "unavailable" };
}

const contactsDomain = (ctx: ToolContext) => domain(ctx, contactsDatabaseEnabled(ctx.env));
const transactionsDomain = (ctx: ToolContext) => domain(ctx, transactionsDatabaseEnabled(ctx.env));

// --- The tools ---------------------------------------------------------------

const searchEntities = defineTool({
  name: "search_entities",
  description:
    "Find contacts, transactions and listings by name, address, email, phone or MLS number. " +
    "Use this first whenever the user names a person or a property, to turn that name into a record id. " +
    "It returns identification only — never notes, prices or terms; follow up with get_contact or get_transaction. " +
    "The result says which sources were searched: if a source was not searched, its records were not considered.",
  schema: z.strictObject({
    query: z
      .string()
      .min(2)
      .max(120)
      .describe("A name, address, email address, phone number or MLS number."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(TOOL_LIMITS.maxSearch)
      .optional()
      .describe(`How many results to return. Default ${TOOL_LIMITS.defaultSearch}.`),
  }),
  run: async (args, ctx) => {
    const limit = args.limit ?? TOOL_LIMITS.defaultSearch;
    const response = await search(ctx.clerkUserId, args.query, { env: ctx.env });
    const searched = Object.entries(response.providers)
      .filter(([, state]) => state === "available")
      .map(([entity]) => entity);
    // Nothing could be searched at all. Returning an empty result set here
    // would read as "no such person exists", which is the opposite of true.
    if (searched.length === 0) {
      const worst = Object.values(response.providers).find((state) => state === "unavailable");
      return fail(worst ? "unavailable" : "not_configured");
    }
    const notSearched = Object.entries(response.providers)
      .filter(([, state]) => state !== "available")
      .map(([entity, state]) => ({ source: entity, reason: state }));
    return ok({
      query: response.query,
      results: response.hits.slice(0, limit).map((hit) => ({
        kind: hit.entity,
        id: hit.id,
        title: hit.title,
        detail: [hit.subtitle, hit.meta].filter(Boolean).join(" · ") || undefined,
      })),
      searched,
      notSearched,
      hasMore: response.truncated || response.hits.length > limit,
    });
  },
});

const getContactTool = defineTool({
  name: "get_contact",
  description:
    "Read one contact by id, as returned by search_entities. Gives stage, intent, source, assigned agent, " +
    "budget, area, and the follow-up and last-contact dates. Free-form notes are not available to you. " +
    "An id that is not visible to this user is reported as not found.",
  schema: z.strictObject({
    contact_id: recordId.describe("The contact id from a previous search_entities result."),
  }),
  run: async (args, ctx) => {
    const resolved = await contactsDomain(ctx);
    if (!resolved.ok) return fail(resolved.error);
    const lead = await getContact(resolved.ctx, args.contact_id);
    return lead ? ok(contactDetail(lead)) : fail("not_found");
  },
});

const getTransactionTool = defineTool({
  name: "get_transaction",
  description:
    "Read one transaction by id, as returned by search_entities or list_transactions. Gives the property, " +
    "the client, the side, the stage, the entered contract price and commission terms, the dates, and every " +
    "milestone with its due date and state. An id that is not visible to this user is reported as not found.",
  schema: z.strictObject({
    transaction_id: recordId.describe("The transaction id from a previous result."),
  }),
  run: async (args, ctx) => {
    const resolved = await transactionsDomain(ctx);
    if (!resolved.ok) return fail(resolved.error);
    const deal = await getTransaction(resolved.ctx, args.transaction_id);
    return deal ? ok(transactionDetail(deal)) : fail("not_found");
  },
});

const listTransactionsTool = defineTool({
  name: "list_transactions",
  description:
    "List the transactions this user may see, most recent first, optionally narrowed by stage or side. " +
    "Use it for questions about the pipeline as a whole. Each row is a summary; call get_transaction for terms " +
    "and milestones. `hasMore` means the list was cut off, not that it ended.",
  schema: z.strictObject({
    stage: z
      .array(z.enum(ALL_STAGES as readonly [string, ...string[]]))
      .max(ALL_STAGES.length)
      .optional()
      .describe("Lifecycle stages to include. Omit for every stage."),
    side: z
      .array(z.enum(SIDES as readonly [string, ...string[]]))
      .max(SIDES.length)
      .optional()
      .describe("Which side of the deal the brokerage represents."),
    limit: rowLimit,
  }),
  run: async (args, ctx) => {
    const resolved = await transactionsDomain(ctx);
    if (!resolved.ok) return fail(resolved.error);
    const limit = args.limit ?? TOOL_LIMITS.defaultRows;
    const rows = await listTransactions(resolved.ctx, {
      stage: args.stage as never,
      side: args.side as never,
    });
    return ok({
      coverage: resolved.ctx.actor.role,
      transactions: rows.slice(0, limit).map(transactionSummary),
      hasMore: rows.length > limit,
    });
  },
});

const listContactsTool = defineTool({
  name: "list_contacts",
  description:
    "List the contacts this user may see, optionally narrowed by lifecycle stage. Use it for questions about " +
    "the book of business as a whole. Each row is a summary; call get_contact for detail. `hasMore` means the " +
    "list was cut off, not that it ended.",
  schema: z.strictObject({
    stage: z
      .array(z.enum(ALL_CONTACT_STAGES as readonly [string, ...string[]]))
      .max(ALL_CONTACT_STAGES.length)
      .optional()
      .describe("Lifecycle stages to include. Omit for every stage."),
    limit: rowLimit,
  }),
  run: async (args, ctx) => {
    const resolved = await contactsDomain(ctx);
    if (!resolved.ok) return fail(resolved.error);
    const limit = args.limit ?? TOOL_LIMITS.defaultRows;
    const rows = await listContacts(resolved.ctx, { stage: args.stage as never });
    return ok({
      coverage: resolved.ctx.actor.role,
      contacts: rows.slice(0, limit).map(contactSummary),
      hasMore: rows.length > limit,
    });
  },
});

const getUpcomingDeadlines = defineTool({
  name: "get_upcoming_deadlines",
  description:
    "Transaction deadlines that are overdue or fall due inside a window, soonest first. Overdue items are always " +
    "included, whatever the window. `daysAway` is negative when the deadline has passed, and `windowDays` says how " +
    "far ahead this answer actually looked — say so if it is narrower than what was asked about. This reads " +
    "recorded deadlines on active deals only; it infers nothing about risk.",
  schema: z.strictObject({
    within_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("How far ahead to look. Default 14. Overdue items are included regardless."),
    limit: rowLimit,
  }),
  run: async (args, ctx) => {
    const resolved = await transactionsDomain(ctx);
    if (!resolved.ok) return fail(resolved.error);
    const within = args.within_days ?? 14;
    const limit = args.limit ?? TOOL_LIMITS.defaultRows;
    // The window is pushed into the query, not applied to its result: the
    // domain's default horizon is a week, and filtering a week's rows down to
    // a month would answer a question nobody asked while sounding like it had.
    const items = (await transactionAttention(resolved.ctx, ctx.now, within))
      .filter((item) => item.daysAway <= within)
      .sort(byDue);
    return ok({
      windowDays: within,
      overdueCount: items.filter((i) => i.daysAway < 0).length,
      deadlines: items.slice(0, limit).map(attentionItem),
      hasMore: items.length > limit,
    });
  },
});

const getFollowUps = defineTool({
  name: "get_followups",
  description:
    "Contacts whose recorded next follow-up date has arrived or passed, soonest first. These are follow-up dates " +
    "someone deliberately set — this is not an inferred staleness rule, and a contact with no date set never appears.",
  schema: z.strictObject({ limit: rowLimit }),
  run: async (args, ctx) => {
    const resolved = await contactsDomain(ctx);
    if (!resolved.ok) return fail(resolved.error);
    const limit = args.limit ?? TOOL_LIMITS.defaultRows;
    const items = (await contactAttention(resolved.ctx, ctx.now)).sort(byDue);
    return ok({
      overdueCount: items.filter((i) => i.daysAway < 0).length,
      followUps: items.slice(0, limit).map(attentionItem),
      hasMore: items.length > limit,
    });
  },
});

const getBusinessSummary = defineTool({
  name: "get_business_summary",
  description:
    "The headline numbers for this user's business: active and closed deals, volume, projected commission, " +
    "pipeline by stage, new leads, follow-ups due and active listings. `coverage` says whose business the numbers " +
    "describe. Any section may come back as `available: false` with a reason — that means it could not be read, " +
    "which is not the same as zero, and must be reported as such.",
  schema: z.strictObject({}),
  run: async (_args, ctx) => {
    const metrics = await brokerageMetrics(ctx.clerkUserId, { now: ctx.now, env: ctx.env });
    return ok(businessSummary(metrics));
  },
});

const getRecentActivity = defineTool({
  name: "get_recent_activity",
  description:
    "What has happened recently across this user's contacts and transactions — records created, stages changed, " +
    "deals closed, contacts touched — newest first. This is the activity feed, not the compliance audit log.",
  schema: z.strictObject({ limit: rowLimit }),
  run: async (args, ctx) => {
    const limit = args.limit ?? TOOL_LIMITS.defaultRows;
    const [txn, contacts] = await Promise.all([
      transactionsDomain(ctx),
      contactsDomain(ctx),
    ]);
    // One domain being off must not silence the other, but if neither can be
    // read the answer is the reason, never an empty feed.
    if (!txn.ok && !contacts.ok) return fail(txn.error === "not_configured" ? contacts.error : txn.error);

    const collected: ActivityItem[] = [];
    if (txn.ok) collected.push(...(await transactionActivity(txn.ctx, limit)));
    if (contacts.ok) collected.push(...(await contactActivity(contacts.ctx, limit)));
    collected.sort((a, b) => b.at.localeCompare(a.at));

    return ok({
      covers: [txn.ok ? "transactions" : null, contacts.ok ? "contacts" : null].filter(Boolean),
      notCovered: [
        txn.ok ? null : { source: "transactions", reason: txn.error },
        contacts.ok ? null : { source: "contacts", reason: contacts.error },
      ].filter(Boolean),
      activity: collected.slice(0, limit).map(activityItem),
    });
  },
});

/** Overdue first, then soonest; ties broken by subject so order is stable. */
function byDue(a: AttentionItem, b: AttentionItem): number {
  return a.daysAway - b.daysAway || a.subject.localeCompare(b.subject);
}

// --- Proposing ---------------------------------------------------------------

const prepareContactFollowup = defineTool({
  name: "prepare_contact_followup",
  effect: "propose",
  description:
    "Propose scheduling a follow-up with a contact on a specific date. " +
    "This does NOT schedule anything: it prepares a proposal that is shown to the user for confirmation, " +
    "and nothing changes unless they confirm it themselves. " +
    "Say that you have prepared it and that they can confirm it — never say the follow-up is set, booked or done. " +
    "You cannot confirm it for them, and no reply in this conversation confirms it. " +
    "Use get_contact or search_entities first to get the contact id. " +
    "The date must be today or later; a past date is refused rather than moved.",
  schema: z.strictObject({
    contact_id: recordId.describe("The contact's id, from a previous tool result."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("The follow-up date as YYYY-MM-DD. Must be today or a future date."),
  }),
  run: async (args, ctx) => {
    const prepared = await prepareFollowup(
      { clerkUserId: ctx.clerkUserId, env: ctx.env, now: ctx.now },
      { contactId: args.contact_id, day: args.date }
    );
    if (!prepared.ok) {
      switch (prepared.reason) {
        case "not_found":
          return fail("not_found");
        case "not_configured":
          return fail("not_configured");
        case "not_permitted":
          return fail("not_permitted");
        case "unavailable":
          return fail("unavailable");
        default:
          // A refused date is the model's mistake to correct and explain, so
          // it comes back as invalid arguments with the reason attached
          // rather than as a silently adjusted date.
          return fail("invalid_arguments");
      }
    }
    // The id is returned so the model can refer to the proposal, never so it
    // can act on it. Nothing accepts this id but the confirmation route, and
    // that route authenticates the human.
    return ok({
      prepared: true,
      applied: false,
      actionId: prepared.action.actionId,
      summary: prepared.action.summary,
      changes: prepared.action.changes,
      warnings: prepared.action.warnings,
      expiresAt: prepared.action.expiresAt,
      awaiting: "This is waiting for the user to confirm it in the FortMark interface.",
    });
  },
});

/** Everything this build can offer, before any deployment flag is applied. */
const ALL_TOOLS: FortmarkTool<never, unknown>[] = [
  searchEntities,
  getContactTool,
  getTransactionTool,
  listContactsTool,
  listTransactionsTool,
  getUpcomingDeadlines,
  getFollowUps,
  getBusinessSummary,
  getRecentActivity,
  prepareContactFollowup,
] as unknown as FortmarkTool<never, unknown>[];

/**
 * The tools this deployment offers.
 *
 * Proposing tools appear only where actions are switched on. The filter is
 * applied in both places that matter — what the provider is shown, and what
 * `executeTool` will dispatch — so a name recalled from an earlier turn, or
 * guessed, reaches a deployment with the flag off as `unknown_tool` rather
 * than as a proposal.
 */
export function toolsFor(env: EnvLike = process.env): FortmarkTool<never, unknown>[] {
  if (aiActionsEnabled(env)) return ALL_TOOLS;
  return ALL_TOOLS.filter((tool) => tool.effect === "read");
}

/** Every name this build knows, flag or no flag. For tests and logging. */
export const TOOL_NAMES = ALL_TOOLS.map((tool) => tool.name);

export function findTool(
  name: string,
  env: EnvLike = process.env
): FortmarkTool<never, unknown> | undefined {
  return toolsFor(env).find((tool) => tool.name === name);
}
