import "server-only";

/**
 * Provider configuration for the assistant.
 *
 * Server-only by import guard: `ANTHROPIC_API_KEY` is read here and must never
 * reach a browser bundle.
 *
 * Kept apart from `app/api/chat/route.ts` so the rules that decide whether a
 * paid provider is called at all are pure functions a test can exercise,
 * rather than branches reachable only by serving a request.
 */
import type { EnvLike } from "../flags.ts";

/**
 * The model. Deliberately a constant rather than a request field: `mode`
 * arrives from the browser, and a caller-chosen model is a caller-chosen bill.
 */
export const AI_MODEL = "claude-opus-5";

/**
 * Interactive surface, so this is the latency and cost tuning point. `high` is
 * the API default and is worth more on long-horizon and coding work than on
 * dashboard Q&A; `low` is available if replies need to land faster still.
 * Changing this one string is the whole adjustment.
 */
export const AI_EFFORT = "medium" as const;

/**
 * A ceiling, not a target — brevity comes from the system prompt below, and a
 * cap the model can notice would only truncate it mid-sentence. Well above any
 * reply this surface should produce, so hitting it means something went wrong
 * rather than that the answer was long.
 */
export const AI_MAX_TOKENS = 16000;

/** Reject anything that cannot be a useful conversation. */
export const AI_LIMITS = {
  /** Turns kept from the client's history. Older turns are dropped, not refused. */
  maxMessages: 40,
  /** Per-message character cap. */
  maxMessageChars: 24000,
  /** Total character cap across the whole submitted history. */
  maxTotalChars: 120000,
} as const;

/**
 * What the assistant is, and — more importantly — what it cannot see.
 *
 * This deployment connects no tools, so the assistant has NO access to
 * FortMark listings, transactions, leads, documents or calendar. The mock it
 * replaces answered a pricing question with a comp table of invented
 * addresses and closed prices, which was the right shape for exercising the
 * UI and exactly the wrong thing to ship: a model with no data will produce
 * the same table just as fluently, and in this context it would read as
 * FortMark's own record. Hence the instruction is specific about naming the
 * limit rather than a general request to be careful.
 */
export const AI_SYSTEM_PROMPT = `You are the assistant inside the FortMark dashboard, a workspace used by commercial and residential real estate professionals.

You have no access to FortMark's data. You cannot read listings, transactions, leads, documents, calendars, or any record in this dashboard, and no tool in this conversation can retrieve them.

Because of that:
- Never invent a listing, address, price, comparable sale, date, contact, or document. Do not produce a table of specific properties or closed prices as though you had looked them up.
- When a question depends on FortMark's records, say plainly that you cannot see them, and then help with what does not require them: how to approach the analysis, what inputs it needs, what to check, or a draft the user can fill in.
- If the user supplies figures or details in the conversation, you may work with those. Attribute them to the user rather than to FortMark's records.

You can help with drafting client and broker correspondence, structuring analyses, explaining process and terminology, checklists, and thinking through negotiation or positioning.

Be direct and concise. Answer in a few sentences unless detail is asked for. Use Markdown where structure genuinely helps — the dashboard renders it — and prose where it does not. Write plainly: no hype, no exclamation marks, no emoji. You are not a licensed professional; do not present legal, tax, or appraisal conclusions as advice, and say when something needs a licensed review.`;

/**
 * Permit calls to the paid provider.
 *
 * A SEPARATE gate from key presence, for the same reason the Blob upload flag
 * is separate from its token: a credential can arrive in an environment for
 * some other purpose, and if presence were the switch, adding it would start
 * billed traffic in every scope at once without anyone choosing to.
 *
 * Strict by design — only the exact string "1". "true", "yes" and "on" are all
 * rejected, unlike the general-purpose flags, because this one authorises
 * spending against an external account and a typo should fail closed rather
 * than be guessed generously.
 *
 * It authorises nobody. Clerk authentication and the dashboard allowlist are
 * still enforced by the route ahead of any of this.
 */
export function aiProviderEnabled(env: EnvLike = process.env): boolean {
  return env.AI_CHAT_PROVIDER_ENABLED === "1";
}

export type AiCredential =
  | { ok: true; apiKey: string }
  | { ok: false; reason: "disabled" | "missing_key" };

/**
 * Resolve the credential this subsystem is allowed to use.
 *
 * Returns the key rather than letting the SDK read the ambient environment, so
 * that "is the provider configured" is answered in one place and the answer is
 * the same value the client is later constructed with.
 */
export function resolveAiCredential(env: EnvLike = process.env): AiCredential {
  if (!aiProviderEnabled(env)) return { ok: false, reason: "disabled" };
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "missing_key" };
  return { ok: true, apiKey };
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ParsedChatRequest =
  | { ok: true; messages: ChatTurn[] }
  | { ok: false; reason: "malformed" | "empty" | "too_large" };

/**
 * Validate and normalise the submitted history.
 *
 * The mock forwarded nothing and cost nothing, so the previous handler read
 * `body.messages` straight out of an unchecked cast. Every one of these turns
 * now becomes billed input, which makes the shape of this payload a cost
 * question as well as a correctness one.
 *
 * Over-long histories are TRIMMED to the most recent turns rather than
 * refused: a long conversation is normal use, and failing it would be a worse
 * answer than continuing with the part that matters. A single oversized
 * message is refused, because silently truncating what someone wrote would
 * change their question without telling them.
 */
export function parseChatRequest(body: unknown): ParsedChatRequest {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "malformed" };
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return { ok: false, reason: "malformed" };

  const turns: ChatTurn[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return { ok: false, reason: "malformed" };
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return { ok: false, reason: "malformed" };
    if (typeof content !== "string") return { ok: false, reason: "malformed" };
    if (content.length > AI_LIMITS.maxMessageChars) return { ok: false, reason: "too_large" };
    // Blank turns are dropped rather than rejected — an empty assistant bubble
    // from an aborted stream is a normal thing to find in a thread, and the
    // API rejects empty content outright.
    if (content.trim().length === 0) continue;
    turns.push({ role, content });
  }

  const recent = turns.slice(-AI_LIMITS.maxMessages);

  // Trim from the front until the whole history fits.
  let total = recent.reduce((n, m) => n + m.content.length, 0);
  while (recent.length > 1 && total > AI_LIMITS.maxTotalChars) {
    total -= recent.shift()!.content.length;
  }
  if (total > AI_LIMITS.maxTotalChars) return { ok: false, reason: "too_large" };

  // The API requires the first turn to be `user`. Dropping a leading assistant
  // turn is safe: it is context the model produced, not something asked of it.
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();

  if (recent.length === 0) return { ok: false, reason: "empty" };
  if (recent[recent.length - 1].role !== "user") return { ok: false, reason: "empty" };

  return { ok: true, messages: recent };
}
