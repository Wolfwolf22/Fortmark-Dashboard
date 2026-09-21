/**
 * Local stand-ins for the two vendors' streaming endpoints.
 *
 * They exist to answer a question types cannot: **is the request an adapter
 * builds actually well formed, and does its SSE stream parse?** Everything
 * else in the provider suite drives the translation functions directly, which
 * proves the mapping but never sends a byte. These send the bytes.
 *
 * It captures the request body so the test can assert what was sent — the
 * tools, the tool_choice, the instructions, and `store: false` — and replays a
 * scripted event sequence as `text/event-stream` in the shape the SDK's
 * parser expects.
 *
 * No credential is involved. Each adapter is pointed at its stub with
 * `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL`, which the official SDKs read
 * themselves — so neither adapter needs a test-only parameter.
 */
import { createServer, type Server } from "node:http";

export interface StubCapture {
  path: string;
  body: Record<string, unknown>;
}

export interface Stub {
  baseUrl: string;
  captured: StubCapture[];
  close: () => Promise<void>;
}

/** Serialise one Responses event as the SDK's parser expects to read it. */
function sse(event: Record<string, unknown>): string {
  return `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function startOpenaiStub(events: Record<string, unknown>[]): Promise<Stub> {
  const captured: StubCapture[] = [];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        // A malformed body is itself a finding; the test asserts on what
        // arrived rather than on this parse succeeding.
      }
      captured.push({ path: request.url ?? "", body });

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for (const event of events) response.write(sse(event));
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    captured,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A local stand-in for the Anthropic Messages endpoint.
 *
 * Same job as the one above, in the other vendor's event format: a named SSE
 * event per message, which is what that SDK's stream helper reads.
 */
export async function startAnthropicStub(events: Record<string, unknown>[]): Promise<Stub> {
  const captured: StubCapture[] = [];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        // A malformed body is itself a finding; the test asserts on what
        // arrived rather than on this parse succeeding.
      }
      captured.push({ path: request.url ?? "", body });

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for (const event of events) response.write(sse(event));
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    captured,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
