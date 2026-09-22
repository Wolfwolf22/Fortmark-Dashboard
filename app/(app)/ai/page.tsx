"use client";

/**
 * AI — a streaming assistant over the workspace. Threads persist locally
 * (`lib/ai/store.ts`); tokens arrive through `sendMessage` (`lib/ai/client.ts`),
 * which is provider-agnostic by design.
 */
import * as React from "react";
import { Sparkles } from "lucide-react";
import { ActionCard } from "@/components/ai/action-card";
import { Composer } from "@/components/ai/composer";
import { MessageBubble } from "@/components/ai/message-bubble";
import { ThreadSidebar } from "@/components/ai/thread-sidebar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ChatError, sendMessage } from "@/lib/ai/client";
import { fetchPendingActions } from "@/lib/ai/actions/client";
import type { PreparedAction } from "@/lib/ai/actions/contract";
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

  /**
   * Proposals the server says are waiting for this user.
   *
   * Fetched from the API, never parsed out of the reply. The assistant's
   * stream is plain text and text from a model is not authority: it can
   * describe a change it never prepared, or describe one it did prepare
   * incorrectly. Asking the server closes both gaps — a card exists only if a
   * row exists, and it says what the row says.
   */
  const [pending, setPending] = React.useState<PreparedAction[]>([]);

  const abortRef = React.useRef<AbortController | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const transcriptRef = React.useRef<HTMLDivElement>(null);

  // Persisted threads only exist on the client; render the shell first so
  // the server and client agree on the initial markup.
  React.useEffect(() => setMounted(true), []);

  // Abort any in-flight stream when the page unmounts.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  // A proposal prepared in an earlier visit may still be live. Surfacing it is
  // what lets someone decline it; left unseen it would simply expire, which is
  // safe but leaves them unable to say no.
  React.useEffect(() => {
    const controller = new AbortController();
    void fetchPendingActions(controller.signal)
      .then(setPending)
      .catch(() => {});
    return () => controller.abort();
  }, []);

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
        // A ChatError already carries the route's own reason, phrased for a
        // person; anything else is a transport failure worth retrying.
        setError(
          e instanceof ChatError
            ? e.message
            : e instanceof Error
              ? `${e.message}. Check your connection and send it again.`
              : "The reply could not be loaded. Send it again."
        );
      }
    } finally {
      abortRef.current = null;
      setStreamingId(null);
    }

    // The turn is over; ask what it left behind. A failure here is silent by
    // design: no card is the correct rendering of "nothing is pending", and a
    // deployment without actions has no pending list to report on.
    try {
      setPending(await fetchPendingActions());
    } catch {
      // Leave whatever was already on screen; it is server-authored either way.
    }
  }

  /**
   * A settled proposal stays on screen showing what happened.
   *
   * It is deliberately NOT removed here. Dropping the row unmounts the card
   * the instant Confirm is pressed, so the person who just authorised a change
   * watches it vanish with no confirmation that it took — the card's own
   * "Confirmed and saved" state never gets to render. Keeping it mounted is
   * the whole feedback.
   *
   * It leaves on its own: the next turn re-fetches, and the server only
   * returns proposals that are still pending.
   */
  function settleAction(actionId: string, outcome: "confirmed" | "declined") {
    // Recorded for the log trail a turn leaves behind; the card owns the
    // on-screen state from here.
    console.debug(`[ai] action ${outcome}`, actionId);
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

            {/* Below the reply they belong to, and above any error: a
                proposal is the last thing that happened in the turn. */}
            {pending.map((action) => (
              <ActionCard key={action.actionId} action={action} onSettled={settleAction} />
            ))}

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
