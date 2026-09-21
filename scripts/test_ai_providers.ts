/**
 * Provider parity tests.
 *
 * The claim this suite exists to defend is narrow and load-bearing: **the
 * vendor is the reasoning layer and nothing else.** The same question must
 * reach the same FortMark service, under the same authorization, with the same
 * bounds, and produce the same thing on screen, whichever company answered it.
 *
 * So every scenario below is run TWICE — once through a scripted Anthropic
 * wire stream and once through a scripted OpenAI one — and the two results are
 * asserted equal. Not similar: equal. A difference in what a user sees is a
 * difference the abstraction was supposed to absorb.
 *
 * Neither vendor's API is contacted. No key is needed to run this and none is
 * read: the adapters' translation functions are driven with literal event
 * arrays, which is also the only way to script the cases that matter — a
 * stream that dies partway, arguments that are not valid JSON, a model that
 * will not stop calling tools.
 *
 * Run: npm run test:ai:providers
 */
import { readFileSync } from "node:fs";
import {
  toInputItems,
  toTurnEvents as openaiEvents,
  toolDefinitions as openaiTools,
  type WireEvent as OpenaiWire,
} from "../lib/ai/providers/openai.ts";
import {
  toMessage,
  toTurnEvents as anthropicEvents,
  toolDefinitions as anthropicTools,
  type WireEvent as AnthropicWire,
} from "../lib/ai/providers/anthropic.ts";
import {
  CREDENTIAL_VARIABLE,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  parseProvider,
  resolveProvider,
  selectedModel,
} from "../lib/ai/providers/select.ts";
import { assistantHealth } from "../lib/ai/availability.ts";
import { runAssistant } from "../lib/ai/loop.ts";
import { EMPTY_TURN_TEXT, INTERRUPTED_TEXT, TOOL_BUDGET_TEXT } from "../lib/ai/stream.ts";
import { MAX_TOOL_ROUNDS } from "../lib/ai/provider.ts";
import { TOOL_NAMES } from "../lib/ai/tools/registry.ts";
import type { ToolContext } from "../lib/ai/tools/types.ts";
import type { NeutralTurn, OpenedRound, TurnEvent } from "../lib/ai/providers/types.ts";
import { startAnthropicStub, startOpenaiStub } from "./provider-stubs.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

/** Source with comments stripped: a word in prose is not a word in code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// A syntactically plausible shape only — never a real credential.
const ANTHROPIC_KEY = "sk-ant-api03-example";
const OPENAI_KEY = "sk-proj-example";

// =============================================================================
// Provider selection
// =============================================================================

check("an unset provider keeps the documented default", parseProvider({}) === DEFAULT_PROVIDER);
check("the documented default is the vendor that was here first",
  DEFAULT_PROVIDER === "anthropic");
check("each vendor can be selected by name",
  parseProvider({ AI_PROVIDER: "anthropic" }) === "anthropic" &&
    parseProvider({ AI_PROVIDER: "openai" }) === "openai");
check("surrounding whitespace is tolerated", parseProvider({ AI_PROVIDER: " openai " }) === "openai");

// Fail closed. A typo must be refused, never coerced into a guess and never
// quietly served by the other vendor.
check("a misspelled vendor is refused, not guessed",
  parseProvider({ AI_PROVIDER: "openAI" }) === null &&
    parseProvider({ AI_PROVIDER: "OpenAI" }) === null &&
    parseProvider({ AI_PROVIDER: "gpt" }) === null &&
    parseProvider({ AI_PROVIDER: "claude" }) === null);

check("the flag alone is not enough",
  resolveProvider({ AI_CHAT_PROVIDER_ENABLED: "1" }).ok === false);
check("a key alone is not enough",
  resolveProvider({ ANTHROPIC_API_KEY: ANTHROPIC_KEY }).ok === false);
check("the flag is strict about its value",
  resolveProvider({ AI_CHAT_PROVIDER_ENABLED: "true", ANTHROPIC_API_KEY: ANTHROPIC_KEY }).ok === false &&
    resolveProvider({ AI_CHAT_PROVIDER_ENABLED: " 1 ", ANTHROPIC_API_KEY: ANTHROPIC_KEY }).ok === false);

{
  const resolved = resolveProvider({
    AI_CHAT_PROVIDER_ENABLED: "1",
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: `  ${OPENAI_KEY}  `,
  });
  check("a selected vendor with its key resolves", resolved.ok);
  check("the resolved key is trimmed", resolved.ok && resolved.apiKey === OPENAI_KEY);
  check("the resolved vendor is the selected one", resolved.ok && resolved.name === "openai");
  check("an unset model falls to that vendor's documented default",
    resolved.ok && resolved.model === DEFAULT_MODEL.openai);
}

check("AI_MODEL overrides the default, server-side",
  (() => {
    const r = resolveProvider({
      AI_CHAT_PROVIDER_ENABLED: "1",
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: OPENAI_KEY,
      AI_MODEL: "gpt-5.4-mini",
    });
    return r.ok && r.model === "gpt-5.4-mini";
  })());

// --- No cross-vendor fallback, in either direction ---------------------------
//
// The rule certification depends on. A missing key for the SELECTED vendor
// means the assistant is unavailable — never that the other one answers.
{
  const anthropicSelectedOpenaiKeyed = resolveProvider({
    AI_CHAT_PROVIDER_ENABLED: "1",
    AI_PROVIDER: "anthropic",
    OPENAI_API_KEY: OPENAI_KEY,
  });
  check("Anthropic selected without its key never falls back to OpenAI",
    anthropicSelectedOpenaiKeyed.ok === false &&
      anthropicSelectedOpenaiKeyed.reason === "no_credential" &&
      anthropicSelectedOpenaiKeyed.name === "anthropic");

  const openaiSelectedAnthropicKeyed = resolveProvider({
    AI_CHAT_PROVIDER_ENABLED: "1",
    AI_PROVIDER: "openai",
    ANTHROPIC_API_KEY: ANTHROPIC_KEY,
  });
  check("OpenAI selected without its key never falls back to Anthropic",
    openaiSelectedAnthropicKeyed.ok === false &&
      openaiSelectedAnthropicKeyed.reason === "no_credential" &&
      openaiSelectedAnthropicKeyed.name === "openai");

  // Both present: the selection still decides, not availability.
  const both = resolveProvider({
    AI_CHAT_PROVIDER_ENABLED: "1",
    AI_PROVIDER: "openai",
    ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    OPENAI_API_KEY: OPENAI_KEY,
  });
  check("with both keys present the selection still decides",
    both.ok && both.name === "openai" && both.apiKey === OPENAI_KEY);
}

check("an invalid vendor resolves to nothing at all",
  (() => {
    const r = resolveProvider({
      AI_CHAT_PROVIDER_ENABLED: "1",
      AI_PROVIDER: "gemini",
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      OPENAI_API_KEY: OPENAI_KEY,
    });
    return r.ok === false && r.reason === "invalid_provider" && r.name === null;
  })());

check("each vendor's credential variable is named once, in one place",
  CREDENTIAL_VARIABLE.anthropic === "ANTHROPIC_API_KEY" &&
    CREDENTIAL_VARIABLE.openai === "OPENAI_API_KEY");

// =============================================================================
// Health vocabulary
// =============================================================================
{
  const full = {
    AI_CHAT_PROVIDER_ENABLED: "1",
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: OPENAI_KEY,
  };
  check("a working assistant reports its vendor and availability",
    JSON.stringify(assistantHealth(full)) === '{"provider":"openai","model":"gpt-5.5","status":"available"}');
  check("a switched-off assistant still reports which vendor is selected",
    JSON.stringify(assistantHealth({ ...full, AI_CHAT_PROVIDER_ENABLED: "" })) ===
      '{"provider":"openai","model":"gpt-5.5","status":"disabled"}');
  check("a missing credential names the vendor whose key is missing",
    JSON.stringify(assistantHealth({ AI_CHAT_PROVIDER_ENABLED: "1", AI_PROVIDER: "openai" })) ===
      '{"provider":"openai","model":"gpt-5.5","status":"no_credential"}');
  check("an unreadable selection reports no vendor at all",
    JSON.stringify(assistantHealth({ AI_PROVIDER: "gemini" })) ===
      '{"provider":null,"model":null,"status":"invalid_provider"}');

  // Anthropic, fully configured. The mirror of the OpenAI case above, so
  // neither vendor's happy path depends on the other's.
  check("a fully configured Anthropic deployment is available",
    JSON.stringify(
      assistantHealth({
        AI_CHAT_PROVIDER_ENABLED: "1",
        AI_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      })
    ) === '{"provider":"anthropic","model":"claude-opus-5","status":"available"}');
  check("an unset vendor with an Anthropic key is available as the default",
    JSON.stringify(
      assistantHealth({ AI_CHAT_PROVIDER_ENABLED: "1", ANTHROPIC_API_KEY: ANTHROPIC_KEY })
    ) === '{"provider":"anthropic","model":"claude-opus-5","status":"available"}');

  // The crux of an explicit selection: setting AI_PROVIDER=openai must beat
  // the default, and must do so even when an Anthropic key is also present.
  // If a deployment reports "anthropic" while AI_PROVIDER=openai is set, the
  // variable is not reaching the runtime — the resolver is not the problem.
  check("an explicit openai selection beats the default, key or no key",
    assistantHealth({ AI_CHAT_PROVIDER_ENABLED: "1", AI_PROVIDER: "openai" }).provider === "openai" &&
      assistantHealth({
        AI_CHAT_PROVIDER_ENABLED: "1",
        AI_PROVIDER: "openai",
        ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      }).provider === "openai" &&
      assistantHealth({
        AI_CHAT_PROVIDER_ENABLED: "1",
        AI_PROVIDER: "openai",
        ANTHROPIC_API_KEY: ANTHROPIC_KEY,
        OPENAI_API_KEY: OPENAI_KEY,
      }).status === "available");

  // The probe and the chat runtime must answer from the same resolver, or a
  // green health check would prove nothing about what a turn would do.
  const availability = code("lib/ai/availability.ts");
  const chatRoute = code("app/api/chat/route.ts");
  check("the probe and the runtime share one resolver",
    /from "\.\/providers\/select\.ts"/.test(availability) &&
      /resolveProvider/.test(availability) &&
      /resolveProvider\(\)/.test(chatRoute));
  check("no second copy of the selection rule exists",
    !/AI_PROVIDER/.test(availability) && !/AI_PROVIDER/.test(code("lib/ai/provider.ts")));

  // The report names the step that would STILL be blocking after the obvious
  // one is done, which is why its order differs from the gate's.
  check("with both missing, the credential is named rather than the flag",
    assistantHealth({}).status === "no_credential");
  check("the other vendor's key never makes this one look available",
    assistantHealth({
      AI_CHAT_PROVIDER_ENABLED: "1",
      AI_PROVIDER: "anthropic",
      OPENAI_API_KEY: OPENAI_KEY,
    }).status === "no_credential");
  check("no fragment of a key is disclosed",
    !JSON.stringify(assistantHealth(full)).includes(OPENAI_KEY.slice(0, 6)));

  // A certification has to state the model it certified, and the probe must
  // name the one a turn would actually use — not a second opinion.
  check("the probe names the effective model",
    assistantHealth(full).model === DEFAULT_MODEL.openai);
  check("an AI_MODEL override is what the probe reports",
    assistantHealth({ ...full, AI_MODEL: "gpt-5.4-mini" }).model === "gpt-5.4-mini");
  check("the probe and the runtime derive the model from one helper",
    selectedModel("openai", { ...full, AI_MODEL: "gpt-5.4-mini" }) === "gpt-5.4-mini" &&
      (() => {
        const r = resolveProvider({ ...full, AI_MODEL: "gpt-5.4-mini" });
        return r.ok && r.model === assistantHealth({ ...full, AI_MODEL: "gpt-5.4-mini" }).model;
      })());
}

// =============================================================================
// One tool registry, two renderings
// =============================================================================
{
  const anthropic = anthropicTools();
  const openai = openaiTools();

  check("both vendors are offered every FortMark tool",
    anthropic.length === TOOL_NAMES.length && openai.length === TOOL_NAMES.length);
  check("both vendors are offered the SAME tools, in the same order",
    JSON.stringify(anthropic.map((t) => t.name)) === JSON.stringify(openai.map((t) => t.name)) &&
      JSON.stringify(anthropic.map((t) => t.name)) === JSON.stringify(TOOL_NAMES));
  check("both vendors receive the same schema for each tool",
    anthropic.every((tool, i) =>
      JSON.stringify(tool.input_schema) === JSON.stringify(openai[i].parameters)));
  check("both vendors receive the same description for each tool",
    anthropic.every((tool, i) => tool.description === openai[i].description));

  // Neither adapter may invent a tool, and neither may define one of its own.
  const anthropicSrc = code("lib/ai/providers/anthropic.ts");
  const openaiSrc = code("lib/ai/providers/openai.ts");
  for (const [name, src] of [["anthropic", anthropicSrc], ["openai", openaiSrc]] as const) {
    check(`the ${name} adapter defines no tool of its own`,
      /READ_ONLY_TOOLS\.map/.test(src) && !/name: "(get|list|search)_/.test(src));
    check(`the ${name} adapter reads no record and resolves no actor`,
      !/resolveActor|visibleTo|getContact|listTransactions|brokerageMetrics|\bdb\b/.test(src));
    // It parses argument JSON into an object — that is translation — but it
    // never decides whether the arguments are acceptable, and never runs one.
    check(`the ${name} adapter validates and executes no tool`,
      !/safeParse|\bzod\b|tool\.parse\(|findTool|executeTool|executeRound/.test(src));
    check(`the ${name} adapter enforces no round budget of its own`,
      !/MAX_TOOL_ROUNDS|MAX_TOOL_CALLS/.test(src));
    check(`the ${name} adapter honours the final round's tool ban`,
      /options\.allowTools/.test(src));
  }
}

// =============================================================================
// Wire protocol translation
// =============================================================================

const anthropicWire = {
  text: (t: string, index = 0) =>
    ({ type: "content_block_delta", index, delta: { type: "text_delta", text: t } }) as unknown as AnthropicWire,
  thinking: (t: string) =>
    ({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } }) as unknown as AnthropicWire,
  start: () => ({ type: "message_start", message: {} }) as unknown as AnthropicWire,
  toolOpen: (index: number, id: string, name: string) =>
    ({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } }) as unknown as AnthropicWire,
  toolJson: (index: number, partial: string) =>
    ({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partial } }) as unknown as AnthropicWire,
  toolClose: (index: number) => ({ type: "content_block_stop", index }) as unknown as AnthropicWire,
  stop: () => ({ type: "message_stop" }) as unknown as AnthropicWire,
};

const openaiWire = {
  text: (t: string) =>
    ({ type: "response.output_text.delta", delta: t, item_id: "m1", content_index: 0, output_index: 0, sequence_number: 0, logprobs: [] }) as unknown as OpenaiWire,
  reasoning: (t: string) =>
    ({ type: "response.reasoning_text.delta", delta: t, item_id: "r1", content_index: 0, output_index: 0, sequence_number: 0 }) as unknown as OpenaiWire,
  created: () => ({ type: "response.created", response: {}, sequence_number: 0 }) as unknown as OpenaiWire,
  toolArgs: (partial: string) =>
    ({ type: "response.function_call_arguments.delta", delta: partial, item_id: "fc1", output_index: 0, sequence_number: 0 }) as unknown as OpenaiWire,
  toolDone: (callId: string, name: string, args: string) =>
    ({
      type: "response.output_item.done",
      output_index: 0,
      sequence_number: 0,
      item: { type: "function_call", call_id: callId, name, arguments: args, id: "fc1", status: "completed" },
    }) as unknown as OpenaiWire,
  completed: () => ({ type: "response.completed", response: {}, sequence_number: 0 }) as unknown as OpenaiWire,
  failed: () => ({ type: "response.failed", response: {}, sequence_number: 0 }) as unknown as OpenaiWire,
};

async function* feed<T>(events: T[], failAfter = -1): AsyncGenerator<T> {
  for (const [i, event] of events.entries()) {
    if (i === failAfter) throw new Error("provider exploded");
    yield event;
  }
  if (failAfter === events.length) throw new Error("provider exploded");
}

async function drain(events: AsyncGenerator<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

// --- Each vendor's protocol, reduced to the same neutral events --------------
{
  const anthropic = await drain(
    anthropicEvents(
      feed([
        anthropicWire.start(),
        anthropicWire.thinking("weighing it up"),
        anthropicWire.text("Checking."),
        anthropicWire.toolOpen(1, "tu_1", "get_contact"),
        anthropicWire.toolJson(1, '{"contact_'),
        anthropicWire.toolJson(1, 'id":"c-42"}'),
        anthropicWire.toolClose(1),
        anthropicWire.stop(),
      ])
    )
  );
  const openai = await drain(
    openaiEvents(
      feed([
        openaiWire.created(),
        openaiWire.reasoning("weighing it up"),
        openaiWire.text("Checking."),
        openaiWire.toolArgs('{"contact_'),
        openaiWire.toolArgs('id":"c-42"}'),
        openaiWire.toolDone("tu_1", "get_contact", '{"contact_id":"c-42"}'),
        openaiWire.completed(),
      ])
    )
  );

  check("both protocols reduce to the same neutral events",
    JSON.stringify(anthropic) === JSON.stringify(openai));
  check("the reduction is text then a tool call, and nothing else",
    anthropic.length === 2 && anthropic[0].type === "text" && anthropic[1].type === "tool_call");
  check("neither vendor's reasoning survives translation",
    !JSON.stringify(anthropic).includes("weighing") &&
      !JSON.stringify(openai).includes("weighing"));
  check("neither vendor's argument fragments survive as text",
    !JSON.stringify(anthropic).includes('"text":"{\\"contact_') &&
      !JSON.stringify(openai).includes('"text":"{\\"contact_'));
}

// --- Unreadable arguments, both vendors --------------------------------------
{
  const anthropic = await drain(
    anthropicEvents(
      feed([
        anthropicWire.toolOpen(0, "tu_x", "get_contact"),
        anthropicWire.toolJson(0, '{"contact_id": "c-1'),
        anthropicWire.toolClose(0),
      ])
    )
  );
  const openai = await drain(
    openaiEvents(feed([openaiWire.toolDone("tu_x", "get_contact", '{"contact_id": "c-1')]))
  );
  check("both vendors flag unparseable arguments rather than guessing",
    JSON.stringify(anthropic) === JSON.stringify(openai) &&
      anthropic[0].type === "tool_call" &&
      anthropic[0].call.invalid === true &&
      JSON.stringify(anthropic[0].call.input) === "{}");
}

// --- A tool with no arguments ------------------------------------------------
{
  const anthropic = await drain(
    anthropicEvents(feed([anthropicWire.toolOpen(0, "tu_a", "get_business_summary"), anthropicWire.toolClose(0)]))
  );
  const openai = await drain(
    openaiEvents(feed([openaiWire.toolDone("tu_a", "get_business_summary", "")]))
  );
  check("both vendors turn no arguments into an empty object",
    JSON.stringify(anthropic) === JSON.stringify(openai) &&
      anthropic[0].type === "tool_call" &&
      JSON.stringify(anthropic[0].call.input) === "{}" &&
      !anthropic[0].call.invalid);
}

// --- History renders into each vendor's own shape ----------------------------
{
  const history: NeutralTurn[] = [
    { role: "user", text: "what's going on with Brickell?" },
    {
      role: "assistant",
      text: "Checking.",
      toolCalls: [{ id: "tu_1", name: "get_transaction", input: { transaction_id: "t-1" } }],
    },
    {
      role: "tool_results",
      results: [{ id: "tu_1", name: "get_transaction", payload: '{"stage":"under_contract"}', isError: false }],
    },
  ];

  const anthropic = history.map(toMessage);
  const openai = history.flatMap(toInputItems);

  check("Anthropic sees tool results as one user message with tool_result blocks",
    anthropic[2].role === "user" &&
      Array.isArray(anthropic[2].content) &&
      (anthropic[2].content as { type: string; tool_use_id?: string }[])[0].type === "tool_result" &&
      (anthropic[2].content as { type: string; tool_use_id?: string }[])[0].tool_use_id === "tu_1");
  check("OpenAI sees tool results as function_call_output items",
    openai.some((item) => (item as { type?: string }).type === "function_call_output") &&
      openai.some((item) => (item as { call_id?: string }).call_id === "tu_1"));
  check("both renderings carry the same call id back",
    JSON.stringify(anthropic).includes("tu_1") && JSON.stringify(openai).includes("tu_1"));
  check("both renderings carry the payload unaltered",
    JSON.stringify(anthropic).includes("under_contract") &&
      JSON.stringify(openai).includes("under_contract"));
  check("an assistant turn with a call renders the call for both",
    JSON.stringify(anthropic[1]).includes("get_transaction") &&
      JSON.stringify(openai).includes("get_transaction"));
}

// =============================================================================
// Parity: the same interaction, through both adapters
// =============================================================================
//
// Each scenario is a pair of wire scripts that mean the same thing. The loop,
// the registry, the executor and the authorization are identical; only the
// bytes on the way in differ. If the two visible outputs ever diverge, the
// abstraction has failed at the only thing it was for.

const ctx: ToolContext = {
  clerkUserId: "user_test",
  env: {},
  now: new Date("2026-03-15T12:00:00.000Z"),
  traceId: "paritytest",
};

type Script = { anthropic: AnthropicWire[]; openai: OpenaiWire[] };

function roundOf(script: Script, vendor: "anthropic" | "openai", failAfter = -1): OpenedRound {
  const events =
    vendor === "anthropic"
      ? anthropicEvents(feed(script.anthropic, failAfter))
      : openaiEvents(feed(script.openai, failAfter));
  return { events: events[Symbol.asyncIterator](), abort: () => {} };
}

/** Run one scenario end to end through one vendor, returning what a user saw. */
async function runThrough(
  vendor: "anthropic" | "openai",
  scripts: Script[],
  log: { allowTools: boolean[] } = { allowTools: [] },
  failAfter = -1
): Promise<string> {
  const history: NeutralTurn[] = [{ role: "user", text: "a question" }];
  let round = 0;
  const provider = {
    openRound: async (_turns: NeutralTurn[], options: { allowTools: boolean }) => {
      log.allowTools.push(options.allowTools);
      round += 1;
      return roundOf(scripts[Math.min(round, scripts.length - 1)], vendor);
    },
  };
  const out: string[] = [];
  for await (const chunk of runAssistant(history, roundOf(scripts[0], vendor, failAfter), ctx, provider)) {
    out.push(chunk);
  }
  return out.join("");
}

/** The same meaning, spelled in each vendor's protocol. */
const say = (t: string): Script => ({
  anthropic: [anthropicWire.text(t), anthropicWire.stop()],
  openai: [openaiWire.text(t), openaiWire.completed()],
});
const callTool = (id: string, name: string, args: string, said = ""): Script => ({
  anthropic: [
    ...(said ? [anthropicWire.text(said)] : []),
    anthropicWire.toolOpen(1, id, name),
    anthropicWire.toolJson(1, args),
    anthropicWire.toolClose(1),
  ],
  openai: [
    ...(said ? [openaiWire.text(said)] : []),
    openaiWire.toolDone(id, name, args),
    openaiWire.completed(),
  ],
});

const SCENARIOS: { name: string; scripts: Script[]; failAfter?: number; expect?: (out: string) => boolean }[] = [
  {
    name: "a general answer that needs no tool",
    scripts: [say("A DSCR is net operating income over debt service.")],
  },
  {
    name: "one tool, then an answer",
    scripts: [callTool("tu_1", "get_business_summary", "{}", "Checking."), say(" Here is the picture.")],
  },
  {
    name: "search, then detail, then an answer",
    scripts: [
      callTool("tu_1", "search_entities", '{"query":"brickell"}'),
      callTool("tu_2", "get_transaction", '{"transaction_id":"t-1"}'),
      say("That deal is under contract."),
    ],
  },
  {
    name: "an ambiguous reference asks rather than guesses",
    scripts: [
      callTool("tu_1", "search_entities", '{"query":"jane"}'),
      say("There are two Janes — which one did you mean?"),
    ],
  },
  {
    name: "an unavailable tool is reported, not turned into an empty answer",
    scripts: [
      callTool("tu_1", "get_followups", "{}"),
      say("I could not read your follow-ups just now."),
    ],
  },
  {
    name: "an unauthorized record reads as absent",
    scripts: [
      callTool("tu_1", "get_contact", '{"contact_id":"someone-elses"}'),
      say("I couldn't find that record."),
    ],
  },
  {
    name: "a turn that produces nothing at all",
    scripts: [{ anthropic: [anthropicWire.stop()], openai: [openaiWire.completed()] }],
    expect: (out) => out === EMPTY_TURN_TEXT,
  },
];

for (const scenario of SCENARIOS) {
  const anthropic = await runThrough("anthropic", scenario.scripts);
  const openai = await runThrough("openai", scenario.scripts);
  check(`parity — ${scenario.name}`, anthropic === openai);
  if (scenario.expect) {
    check(`parity — ${scenario.name} (expected text)`, scenario.expect(anthropic));
  }
}

// --- Parity on the bounds ----------------------------------------------------
{
  const forever = [callTool("tu_x", "get_business_summary", "{}")];
  const anthropicLog = { allowTools: [] as boolean[] };
  const openaiLog = { allowTools: [] as boolean[] };
  const anthropic = await runThrough("anthropic", forever, anthropicLog);
  const openai = await runThrough("openai", forever, openaiLog);

  check("parity — an endless tool loop is stopped identically", anthropic === openai);
  check("parity — both stop with the same budget message",
    anthropic.includes(TOOL_BUDGET_TEXT.trim().slice(0, 20)));
  check("parity — both loops run the same number of rounds",
    anthropicLog.allowTools.length === openaiLog.allowTools.length &&
      anthropicLog.allowTools.length === MAX_TOOL_ROUNDS);
  check("parity — both close their final round to tools",
    anthropicLog.allowTools[MAX_TOOL_ROUNDS - 1] === false &&
      openaiLog.allowTools[MAX_TOOL_ROUNDS - 1] === false);
  check("parity — every earlier round allowed tools on both",
    anthropicLog.allowTools.slice(0, -1).every((a) => a) &&
      openaiLog.allowTools.slice(0, -1).every((a) => a));
}

// --- Parity on an aborted stream ---------------------------------------------
{
  const script = [
    {
      anthropic: [anthropicWire.text("Half an ans"), anthropicWire.text("wer")],
      openai: [openaiWire.text("Half an ans"), openaiWire.text("wer")],
    },
  ];
  const anthropic = await runThrough("anthropic", script, { allowTools: [] }, 2);
  const openai = await runThrough("openai", script, { allowTools: [] }, 2);
  check("parity — a stream that dies partway reads the same", anthropic === openai);
  check("parity — what arrived is kept and the cut is named",
    anthropic.startsWith("Half an answer") && anthropic.endsWith(INTERRUPTED_TEXT));
}

// --- Parity on what must NEVER be rendered -----------------------------------
{
  const script: Script[] = [
    {
      anthropic: [
        anthropicWire.thinking("the user is asking about c-secret"),
        anthropicWire.toolOpen(0, "tu_c", "get_contact"),
        anthropicWire.toolJson(0, '{"contact_id":"c-secret"}'),
        anthropicWire.toolClose(0),
      ],
      openai: [
        openaiWire.reasoning("the user is asking about c-secret"),
        openaiWire.toolDone("tu_c", "get_contact", '{"contact_id":"c-secret"}'),
        openaiWire.completed(),
      ],
    },
    say("I could not read that."),
  ];
  const anthropic = await runThrough("anthropic", script);
  const openai = await runThrough("openai", script);

  check("parity — hidden reasoning reaches the user from neither vendor",
    !anthropic.includes("the user is asking") && !openai.includes("the user is asking"));
  check("parity — tool names reach the user from neither vendor",
    !anthropic.includes("get_contact") && !openai.includes("get_contact"));
  check("parity — tool arguments reach the user from neither vendor",
    !anthropic.includes("c-secret") && !openai.includes("c-secret"));
  check("parity — raw protocol reaches the user from neither vendor",
    !/response\.|content_block|function_call|tool_use/.test(anthropic + openai));
  check("parity — the visible answer is identical", anthropic === openai);
}

// =============================================================================
// A real request, over a real socket
// =============================================================================
//
// Everything above drives the translation functions directly, which proves the
// mapping and never sends a byte. This sends the bytes: the adapter builds a
// request, an HTTP server receives it, and its SSE stream is parsed back by
// the SDK. It is the one check that would catch a request shape the types
// accept and the API would not.
{
  const stub = await startOpenaiStub([
    { type: "response.created", response: {}, sequence_number: 0 },
    { type: "response.reasoning_text.delta", delta: "deciding", item_id: "r1", content_index: 0, output_index: 0, sequence_number: 1 },
    { type: "response.output_text.delta", delta: "Looking that up.", item_id: "m1", content_index: 0, output_index: 0, sequence_number: 2, logprobs: [] },
    {
      type: "response.output_item.done",
      output_index: 1,
      sequence_number: 3,
      item: { type: "function_call", call_id: "call_1", name: "get_business_summary", arguments: "{}", id: "fc1", status: "completed" },
    },
    { type: "response.completed", response: {}, sequence_number: 4 },
  ]);

  // The official SDK reads this itself; the adapter is unchanged.
  process.env.OPENAI_BASE_URL = stub.baseUrl;
  const { openaiProvider } = await import("../lib/ai/providers/openai.ts");
  const provider = openaiProvider(OPENAI_KEY, "gpt-5.5", new AbortController().signal);

  const round = await provider.openRound(
    [{ role: "user", text: "how is my month going?" }],
    { allowTools: true }
  );
  const events = await drain(round.events as AsyncGenerator<TurnEvent>);
  const sent = stub.captured[0];
  await stub.close();
  delete process.env.OPENAI_BASE_URL;

  check("a real request reaches the Responses endpoint", sent?.path.includes("/responses"));
  check("the request carries the system prompt as instructions",
    typeof sent.body.instructions === "string" && (sent.body.instructions as string).length > 500);
  check("the request carries every FortMark tool",
    Array.isArray(sent.body.tools) && (sent.body.tools as unknown[]).length === TOOL_NAMES.length);
  check("the request names the tools as functions",
    JSON.stringify(sent.body.tools).includes('"type":"function"') &&
      JSON.stringify(sent.body.tools).includes('"name":"get_business_summary"'));
  check("the request permits tools on a non-final round", sent.body.tool_choice === "auto");
  check("the request asks the vendor NOT to retain the turn", sent.body.store === false);
  check("the request streams", sent.body.stream === true);
  check("the request names the selected model", sent.body.model === "gpt-5.5");
  check("the request carries the conversation",
    JSON.stringify(sent.body.input).includes("how is my month going?"));
  check("no credential appears in the request body",
    !JSON.stringify(sent.body).includes(OPENAI_KEY));

  check("the streamed response parses into neutral events", events.length === 2);
  check("the streamed text arrives",
    events[0].type === "text" && events[0].text === "Looking that up.");
  check("the streamed tool call arrives, with its id and name",
    events[1].type === "tool_call" &&
      events[1].call.id === "call_1" &&
      events[1].call.name === "get_business_summary");
  check("streamed reasoning does not survive a real round trip",
    !JSON.stringify(events).includes("deciding"));
}

// --- The same round trip, through Anthropic ----------------------------------
{
  const stub = await startAnthropicStub([
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Looking that up." } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_1", name: "get_business_summary", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ]);

  process.env.ANTHROPIC_BASE_URL = stub.baseUrl;
  const { anthropicProvider } = await import("../lib/ai/providers/anthropic.ts");
  const provider = anthropicProvider(ANTHROPIC_KEY, "claude-opus-5", new AbortController().signal);

  const round = await provider.openRound(
    [{ role: "user", text: "how is my month going?" }],
    { allowTools: true }
  );
  const events = await drain(round.events as AsyncGenerator<TurnEvent>);
  const sent = stub.captured[0];
  await stub.close();
  delete process.env.ANTHROPIC_BASE_URL;

  check("a real request reaches the Messages endpoint", sent?.path.includes("/messages"));
  check("the request carries the system prompt",
    JSON.stringify(sent.body.system).length > 500);
  check("the request carries every FortMark tool",
    Array.isArray(sent.body.tools) && (sent.body.tools as unknown[]).length === TOOL_NAMES.length);
  check("the request names the same tool the other vendor was given",
    JSON.stringify(sent.body.tools).includes('"name":"get_business_summary"'));
  check("the request permits tools on a non-final round",
    JSON.stringify(sent.body.tool_choice) === '{"type":"auto"}');
  check("the request names the selected model", sent.body.model === "claude-opus-5");
  check("the request carries the conversation",
    JSON.stringify(sent.body.messages).includes("how is my month going?"));
  check("no credential appears in the request body",
    !JSON.stringify(sent.body).includes(ANTHROPIC_KEY));

  check("the streamed response parses into neutral events", events.length === 2);
  check("the streamed text arrives",
    events[0].type === "text" && events[0].text === "Looking that up.");
  check("the streamed tool call arrives, with its id and name",
    events[1].type === "tool_call" &&
      events[1].call.id === "call_1" &&
      events[1].call.name === "get_business_summary");

  // The whole point, proven on the wire rather than in a mapping table.
  check("both vendors' real round trips produce the same neutral events",
    JSON.stringify(events) ===
      JSON.stringify([
        { type: "text", text: "Looking that up." },
        { type: "tool_call", call: { id: "call_1", name: "get_business_summary", input: {} } },
      ]));
}

// =============================================================================
// The UI never learns which vendor answered
// =============================================================================
{
  const componentSources = [
    "app/(app)/ai/page.tsx",
    "components/ai/composer.tsx",
    "components/ai/message-bubble.tsx",
    "components/ai/thread-sidebar.tsx",
    "lib/ai/client.ts",
  ].map((path) => code(path)).join("\n");

  check("no component names a vendor",
    !/anthropic|openai|gpt-|claude-/i.test(componentSources));
  check("no component imports a vendor SDK",
    !/@anthropic-ai\/sdk|from "openai"/.test(componentSources));
  check("no component handles a vendor protocol",
    !/content_block|response\.output|tool_use|function_call/.test(componentSources));

  // And no vendor key may be a client value, for either vendor.
  const envExample = readFileSync(".env.example", "utf8");
  check("neither key is documented as a client value",
    !envExample.includes("NEXT_PUBLIC_ANTHROPIC") && !envExample.includes("NEXT_PUBLIC_OPENAI"));
  check("both keys are documented by name only",
    /^ANTHROPIC_API_KEY=$/m.test(envExample) && /^OPENAI_API_KEY=$/m.test(envExample));
  check("the vendor selector is documented", /^AI_PROVIDER=$/m.test(envExample));
  check("the model override is documented", /^AI_MODEL=$/m.test(envExample));

  const select = code("lib/ai/providers/select.ts");
  check("the selector is server-only", select.includes('import "server-only"'));
  check("no vendor key is ever a NEXT_PUBLIC value", !/NEXT_PUBLIC/.test(select));
}

// =============================================================================
// Summary
// =============================================================================
const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`\n${passed}/${total} provider checks passed`);
  console.error("Failures:");
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log(`\n${passed}/${total} provider checks passed`);
