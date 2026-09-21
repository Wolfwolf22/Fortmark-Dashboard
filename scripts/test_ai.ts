/**
 * Assistant provider regression tests.
 *
 * Pure-function and stream-transformation coverage for the model call: the
 * flag and credential rules, the request validation that now decides what
 * becomes billed input, and the event handling that decides what reaches the
 * thread.
 *
 * The live provider is NOT exercised here — no key is needed to run this, and
 * none is read. The event sequences below stand in for the cases a live call
 * shows only intermittently: a failure before the first token, a turn that
 * produces no text, reasoning events that must never be forwarded. Anything
 * requiring a real request is asserted STRUCTURALLY and listed for manual QA
 * rather than claimed as verified.
 *
 * Run: npm run test:ai
 */
import { readFileSync } from "node:fs";
import {
  AI_LIMITS,
  AI_MODEL,
  AI_SYSTEM_PROMPT,
  aiProviderEnabled,
  parseChatRequest,
  resolveAiCredential,
} from "../lib/ai/provider.ts";
import {
  EMPTY_TURN_TEXT,
  openTextStream,
  remainingText,
  textDelta,
  type ProviderEvent,
} from "../lib/ai/stream.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}

// Syntactically plausible shape only — never a real credential.
const KEY = "sk-ant-api03-example";

// --- The flag --------------------------------------------------------------
//
// Strict on purpose: this one authorises spending against an external account,
// so a typo must fail closed rather than be read generously.
check("flag on for exactly 1", aiProviderEnabled({ AI_CHAT_PROVIDER_ENABLED: "1" }));
check("flag off when unset", !aiProviderEnabled({}));
check("flag off for true", !aiProviderEnabled({ AI_CHAT_PROVIDER_ENABLED: "true" }));
check("flag off for yes", !aiProviderEnabled({ AI_CHAT_PROVIDER_ENABLED: "yes" }));
check("flag off for on", !aiProviderEnabled({ AI_CHAT_PROVIDER_ENABLED: "on" }));
check("flag off for padded 1", !aiProviderEnabled({ AI_CHAT_PROVIDER_ENABLED: " 1 " }));

// --- Credential resolution -------------------------------------------------
check("a key alone does not enable the provider",
  resolveAiCredential({ ANTHROPIC_API_KEY: KEY }).ok === false);
check("key alone reports disabled, not a missing key",
  resolveAiCredential({ ANTHROPIC_API_KEY: KEY }) as unknown as { reason: string } &&
    (resolveAiCredential({ ANTHROPIC_API_KEY: KEY }) as { reason?: string }).reason === "disabled");
check("flag alone is a missing key",
  (resolveAiCredential({ AI_CHAT_PROVIDER_ENABLED: "1" }) as { reason?: string }).reason ===
    "missing_key");
check("whitespace key is absent",
  (resolveAiCredential({ AI_CHAT_PROVIDER_ENABLED: "1", ANTHROPIC_API_KEY: "   " }) as {
    reason?: string;
  }).reason === "missing_key");
{
  const r = resolveAiCredential({ AI_CHAT_PROVIDER_ENABLED: "1", ANTHROPIC_API_KEY: `  ${KEY}  ` });
  check("flag and key together resolve", r.ok);
  check("the resolved key is trimmed", r.ok && r.apiKey === KEY);
}

// --- Request validation ----------------------------------------------------
//
// Every accepted turn becomes billed input, so this is a cost boundary as well
// as a correctness one.
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

check("a plain exchange parses", parseChatRequest({ messages: [user("hello")] }).ok);
check("null body is malformed", parseChatRequest(null).ok === false);
check("a string body is malformed", parseChatRequest("hi").ok === false);
check("a missing messages array is malformed", parseChatRequest({}).ok === false);
check("a non-array messages field is malformed",
  parseChatRequest({ messages: "hi" }).ok === false);
check("a null turn is malformed", parseChatRequest({ messages: [null] }).ok === false);
check("an unknown role is malformed",
  parseChatRequest({ messages: [{ role: "system", content: "x" }] }).ok === false);
check("a non-string content is malformed",
  parseChatRequest({ messages: [{ role: "user", content: 42 }] }).ok === false);
check("an empty history is empty", parseChatRequest({ messages: [] }).ok === false);

// A single oversized message is refused rather than truncated: silently
// shortening what someone wrote would change their question without saying so.
{
  const huge = "x".repeat(AI_LIMITS.maxMessageChars + 1);
  const r = parseChatRequest({ messages: [user(huge)] });
  check("an oversized message is refused", r.ok === false);
  check("an oversized message reports too_large",
    (r as { reason?: string }).reason === "too_large");
  check("a message at the limit is accepted",
    parseChatRequest({ messages: [user("x".repeat(AI_LIMITS.maxMessageChars))] }).ok);
}

// A long conversation is normal use, so it is trimmed rather than refused.
{
  const many = Array.from({ length: AI_LIMITS.maxMessages + 20 }, (_, i) =>
    i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`)
  );
  const r = parseChatRequest({ messages: [...many, user("latest")] });
  check("an over-long history is trimmed, not refused", r.ok);
  check("trimming keeps at most the message cap",
    r.ok && r.messages.length <= AI_LIMITS.maxMessages);
  check("trimming keeps the most recent turn",
    r.ok && r.messages[r.messages.length - 1].content === "latest");
}
{
  // Total-size trimming drops from the front until the history fits.
  const big = "y".repeat(AI_LIMITS.maxMessageChars);
  const turns = Array.from({ length: 12 }, (_, i) =>
    i % 2 === 0 ? user(big) : assistant(big)
  );
  const r = parseChatRequest({ messages: [...turns, user("tail")] });
  check("an over-large history is trimmed to fit", r.ok);
  check("the trimmed history is within the total cap",
    r.ok && r.messages.reduce((n, m) => n + m.content.length, 0) <= AI_LIMITS.maxTotalChars);
  check("the newest turn survives total trimming",
    r.ok && r.messages[r.messages.length - 1].content === "tail");
}

// The API requires the first turn to be `user`.
{
  const r = parseChatRequest({ messages: [assistant("stale"), user("real question")] });
  check("a leading assistant turn is dropped", r.ok && r.messages[0].role === "user");
  check("dropping it keeps the question", r.ok && r.messages.length === 1);
}
check("an assistant-only history is empty",
  parseChatRequest({ messages: [assistant("x")] }).ok === false);
check("a history ending on an assistant turn is refused",
  parseChatRequest({ messages: [user("q"), assistant("a")] }).ok === false);

// An empty assistant bubble from an aborted stream is normal to find in a
// thread, and the API rejects empty content outright.
{
  const r = parseChatRequest({ messages: [user("q"), assistant("   "), user("q2")] });
  check("blank turns are dropped rather than refused", r.ok);
  check("no empty content survives parsing",
    r.ok && r.messages.every((m) => m.content.trim().length > 0));
}

// --- Event handling --------------------------------------------------------
const ev = (e: unknown) => e as ProviderEvent;
const text = (t: string) =>
  ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } });
const thinking = (t: string) =>
  ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } });
const start = () => ev({ type: "message_start", message: {} });
const stop = () => ev({ type: "message_stop" });

check("a text delta yields its text", textDelta(text("hi")) === "hi");
check("a thinking delta yields nothing", textDelta(thinking("reasoning")) === null);
check("a non-delta event yields nothing", textDelta(start()) === null);
check("a message stop yields nothing", textDelta(stop()) === null);

async function iterate(events: ProviderEvent[], failAfter = -1): Promise<AsyncIterator<ProviderEvent>> {
  async function* gen() {
    for (const [i, e] of events.entries()) {
      if (i === failAfter) throw new Error("provider exploded");
      yield e;
    }
    if (failAfter === events.length) throw new Error("provider exploded");
  }
  return gen()[Symbol.asyncIterator]();
}

const results: Promise<void>[] = [];

results.push(
  (async () => {
    // Reasoning ahead of the answer must not reach the thread.
    const it = await iterate([start(), thinking("weighing it up"), text("Hello"), text(" there")]);
    const opened = await openTextStream(it);
    check("opening succeeds when text arrives", opened.ok);
    check("opening skips past reasoning", opened.ok && opened.first.join("") === "Hello");
    check("opening reports more may follow", opened.ok && !opened.exhausted);
    const rest: string[] = [];
    for await (const chunk of remainingText(it)) rest.push(chunk);
    check("the remainder streams the rest", rest.join("") === " there");
  })()
);

results.push(
  (async () => {
    // A refusal the fallback chain did not rescue: no text at all.
    const it = await iterate([start(), thinking("considering"), stop()]);
    const opened = await openTextStream(it);
    check("a turn with no text still opens", opened.ok);
    check("a turn with no text is exhausted", opened.ok && opened.exhausted);
    check("a turn with no text buffered nothing", opened.ok && opened.first.length === 0);
    check("there is something to say when a turn is empty", EMPTY_TURN_TEXT.length > 0);
  })()
);

results.push(
  (async () => {
    // The case the buffering exists for: failure before a byte is committed.
    const it = await iterate([start()], 1);
    const opened = await openTextStream(it);
    check("a failure before any text is reported, not swallowed", opened.ok === false);
    check("the failure carries the error",
      opened.ok === false && opened.error instanceof Error);
  })()
);

results.push(
  (async () => {
    // Mid-stream: the status is long gone and partial text is rendered, so the
    // turn ends where it broke rather than throwing into a committed response.
    const it = await iterate([text("partial"), text(" answer")], 2);
    const opened = await openTextStream(it);
    check("opening succeeds before a later failure", opened.ok);
    const rest: string[] = [];
    let threw = false;
    try {
      for await (const chunk of remainingText(it)) rest.push(chunk);
    } catch {
      threw = true;
    }
    check("a mid-stream failure does not throw at the caller", !threw);
    check("a mid-stream failure keeps what had arrived", rest.join("") === " answer");
  })()
);

await Promise.all(results);

// --- Structural: the route wiring ------------------------------------------
//
// Serving a request needs Clerk and a live provider, so the ORDER of the gates
// and the shape of the calls are pinned here instead.
{
  const route = readFileSync("app/api/chat/route.ts", "utf8");
  const provider = readFileSync("lib/ai/provider.ts", "utf8");

  // Authorization is unchanged and still runs first.
  check("access is decided before the body is read",
    route.indexOf("decideAccess(userId)") < route.indexOf("request.json()"));
  check("the body is validated before the provider is reached",
    route.indexOf("parseChatRequest(body)") < route.indexOf("resolveAiCredential()"));
  check("an unconfigured environment still serves the mock",
    /if \(!credential\.ok\) return mockResponse\(/.test(route));

  // Off must mean "behaves exactly as it did", which is why the mock stays.
  check("the mock path is retained rather than deleted",
    route.includes("mockReplyFor") && route.includes("function mockResponse"));
  check("both paths emit the same stream headers",
    (route.match(/headers: STREAM_HEADERS/g) ?? []).length === 2);

  // The model is ours, not the caller's. `mode` arrives from the browser.
  check("the model is a constant, not a request field",
    provider.includes('export const AI_MODEL = "claude-opus-5"') &&
      !/model:\s*(body|parsed|opts|mode)/.test(route));
  // `mode` is a composer field that reaches this route from the browser. It is
  // not read at all: a caller-chosen model would be a caller-chosen bill.
  check("the browser-supplied mode field is never read", !/\bmode\b/.test(route));
  check("the parser drops mode rather than forwarding it",
    !/\bmode\b/.test(provider.slice(provider.indexOf("export function parseChatRequest"))));

  // A key must never reach a browser bundle.
  check("the provider module is server-only", provider.includes('import "server-only"'));
  check("the key is never a NEXT_PUBLIC value",
    !provider.includes("NEXT_PUBLIC_ANTHROPIC") && !route.includes("NEXT_PUBLIC_ANTHROPIC"));
  check("the client is constructed with the resolved key",
    route.includes("new Anthropic({ apiKey })"));

  // A provider message can carry request and account identifiers.
  check("no provider message is forwarded to the caller",
    !/error:\s*(error|err)\.message/.test(route) && !/JSON.*error\.message/.test(route));
  check("a rejected key is reported as a server fault, not the caller's",
    /AuthenticationError[\s\S]{0,400}status: 503/.test(route));
  check("a rate limit is distinguishable from a broken key",
    /RateLimitError[\s\S]{0,200}status: 429/.test(route));

  // Cost and correctness properties of the call itself.
  check("a client disconnect is forwarded to the provider",
    route.includes("{ signal }") && route.includes("stream.abort()"));
  check("the function ceiling is raised for a streamed reply",
    /export const maxDuration = \d+/.test(route));
  check("the response is never cached",
    route.includes('"Cache-Control": "private, no-store"'));
  check("streaming is not defeated by a buffering proxy",
    route.includes('"X-Accel-Buffering": "no"'));

  // The assistant has no data access in this deployment, and the mock it
  // replaced answered with invented comps. A fluent model will do the same.
  check("the system prompt states the absence of data access",
    AI_SYSTEM_PROMPT.includes("You have no access to FortMark's data"));
  check("the system prompt forbids inventing records",
    /Never invent a listing, address, price, comparable sale/.test(AI_SYSTEM_PROMPT));
  check("the system prompt is sent with the call", route.includes("system: AI_SYSTEM_PROMPT"));

  // --- Operator-facing configuration ---------------------------------------
  const envExample = readFileSync(".env.example", "utf8");
  check("the flag is documented by name only", /^AI_CHAT_PROVIDER_ENABLED=$/m.test(envExample));
  check("the key is documented by name only", /^ANTHROPIC_API_KEY=$/m.test(envExample));
  check("neither is documented as a client value",
    !envExample.includes("NEXT_PUBLIC_ANTHROPIC") &&
      !envExample.includes("NEXT_PUBLIC_AI_CHAT"));

  // "Flag on, key absent" silently serves mock replies that read as real
  // answers. Two booleans do not make that obvious, so the build resolves it.
  const mig = readFileSync("scripts/migrate.mjs", "utf8");
  check("the build reports which way the assistant resolves",
    /assistant AI_CHAT_PROVIDER_ENABLED=/.test(mig) &&
      /provider.*:.*mock replies|mock replies/.test(mig));
  check("the build warns when the flag is on without a key",
    /flag === "on" && !key[\s\S]{0,300}WARNING: the assistant provider is enabled/.test(mig));
  check("the build never prints the key",
    !/\$\{process\.env\.ANTHROPIC_API_KEY\}/.test(mig));
  check("the build reads the assistant flag strictly",
    /const flag = strict\("AI_CHAT_PROVIDER_ENABLED"\)/.test(mig));
}

// --- Suggestion chips ------------------------------------------------------
//
// Chips advertise capability. No tools are connected, so a chip must ask
// only for what the assistant can do without data: draft, structure,
// explain. Nothing here may promise a lookup.
{
  const src = readFileSync("lib/ai/suggestions.ts", "utf8");
  check("no placeholder chip remains", !/label:\s*"Suggestion \d/.test(src));
  const labels = [...src.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  const prompts = [...src.matchAll(/prompt:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
  check("six chips are defined", labels.length === 6);
  check("every chip has a real prompt", prompts.length === 6 && prompts.every((p) => p.length > 40));
  check("no chip advertises a data lookup",
    !labels.some((l) => /^(search|find|look up|show|pull|list) /i.test(l)) &&
      !prompts.some((p) => /\b(search|find|look up|pull) (my |the |active )?(listings|transactions|leads|clients|documents|comps)\b/i.test(p)));
  check("chips do not use exclamation marks or emoji", !/[!\u{1F300}-\u{1FAFF}]/u.test(labels.join(" ") + prompts.join(" ")));
}

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} assistant checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
