"use client";

/**
 * AI — a streaming assistant over the workspace. Threads persist locally
 * (`lib/ai/store.ts`); tokens arrive through `sendMessage` (`lib/ai/client.ts`),
 * which is provider-agnostic by design.
 */
import * as React from "react";
import { Sparkles } from "lucide-react";
import { Composer } from "@/components/ai/composer";
import { MessageBubble } from "@/components/ai/message-bubble";
import { ThreadSidebar } from "@/components/ai/thread-sidebar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { sendMessage } from "@/lib/ai/client";
import { useAiStore } from "@/lib/ai/store";
import { ChatRole } from "@/lib/ai/types";

export default function Page() {
  const threads = useAiStore((s) => s.threads);
  const activeId = useAiStore((s) => s.activeId);
  const newThread = useAiStore((s) => s.newThread);
  const selectThread = useAiStore((s) => s.selectThread);
  const deleteThread = useAiStore((s) => s.deleteThread);
  const addMessage = useAiStore((s) => s.addMessage);
  const updateMessage = useAiStore((s) => s.updateMessage);
  const removeMessage = useAiStore((s) => s.removeMessage);
  const setFeedback = useAiStore((s) => s.setFeedback);

  const [input, setInput] = React.useState("");
  const [streamingId, setStreamingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const transcriptRef = React.useRef<HTMLDivElement>(null);

  // Persisted threads only exist on the client; render the shell first so
  // the server and client agree on the initial markup.
  React.useEffect(() => setMounted(true), []);

  // Abort any in-flight stream when the page unmounts.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const active = threads.find((t) => t.id === activeId);
  const messages = React.useMemo(() => active?.messages ?? [], [active]);

  // Follow the tail of the transcript as tokens land.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingId]);

  async function run(
    threadId: string,
    history: { role: ChatRole; content: string }[]
  ) {
    const assistantId = addMessage(threadId, "assistant", "");
    setStreamingId(assistantId);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    let text = "";
    try {
      for await (const chunk of sendMessage(history, {
        signal: controller.signal,
      })) {
        text += chunk;
        updateMessage(threadId, assistantId, text);
      }
      // A stop before the first token leaves an empty turn behind — drop it.
      if (!text) removeMessage(threadId, assistantId);
    } catch (e) {
      const aborted =
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        if (!text) removeMessage(threadId, assistantId);
      } else {
        removeMessage(threadId, assistantId);
        setError(
          e instanceof Error
            ? `${e.message}. Check your connection and send it again.`
            : "The reply could not be loaded. Send it again."
        );
      }
    } finally {
      abortRef.current = null;
      setStreamingId(null);
    }
  }

  function submit() {
    const content = input.trim();
    if (!content || streamingId) return;

    // Start a thread on first send so empty threads never accumulate.
    const threadId = activeId ?? newThread();
    addMessage(threadId, "user", content);
    setInput("");

    const history = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content },
    ];
    void run(threadId, history);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function handleNew() {
    stop();
    newThread();
    setInput("");
    setError(null);
    textareaRef.current?.focus();
  }

  function handleSelect(id: string) {
    stop();
    selectThread(id);
    setError(null);
  }

  function handleDelete(id: string) {
    if (id === activeId) stop();
    deleteThread(id);
  }

  const showSuggestions = messages.length === 0 && !streamingId;

  return (
    <div className="flex min-h-0 flex-1 gap-6">
      <aside className="hidden w-60 flex-none lg:block">
        <ThreadSidebar
          threads={mounted ? threads : []}
          activeId={activeId}
          mounted={mounted}
          onSelect={handleSelect}
          onNew={handleNew}
          onDelete={handleDelete}
        />
      </aside>

      {/* min-w-0: without it the flex item refuses to shrink below the
          intrinsic width of a wide markdown table, overflowing on mobile. */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={transcriptRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          aria-live="polite"
          aria-busy={streamingId !== null}
        >
          <div className="mx-auto max-w-3xl space-y-6 pb-6">
            {messages.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Ask about your book of business"
                description="Pricing, pipeline risk, or a draft you can send. Pick a starting point below, or type a question."
                className="py-16"
              />
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  streaming={message.id === streamingId}
                  onFeedback={(feedback) =>
                    active && setFeedback(active.id, message.id, feedback)
                  }
                />
              ))
            )}

            {error && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-panel border border-border bg-tint px-3 py-2 text-[13px]"
              >
                <span>{error}</span>
                <Button variant="outline" size="sm" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl flex-none pt-2">
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            onStop={stop}
            streaming={streamingId !== null}
            showSuggestions={showSuggestions}
            textareaRef={textareaRef}
          />
        </div>
      </section>
    </div>
  );
}
