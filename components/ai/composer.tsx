"use client";

import * as React from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SUGGESTIONS } from "@/lib/ai/suggestions";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 200;

/**
 * The AI composer: auto-growing textarea, Enter to send (Shift+Enter for a
 * newline), and the suggestion chips beneath. Chips fill the composer and
 * focus the caret — they never auto-send.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  showSuggestions,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  /** Chips only show on an empty thread — they are a starting point. */
  showSuggestions: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  // Grow with content up to a ceiling, then scroll inside.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, textareaRef]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && value.trim()) onSubmit();
    }
  }

  function applySuggestion(prompt: string, label: string) {
    // Empty prompt falls back to the chip's own label.
    onChange(prompt || label);
    const el = textareaRef.current;
    if (!el) return;
    // Focus after the value lands so the caret sits at the end.
    window.requestAnimationFrame(() => {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  const canSend = value.trim().length > 0 && !streaming;

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-end gap-2 rounded-panel border border-input bg-card p-2",
          "focus-within:border-foreground/30"
        )}
      >
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask about a listing, a file, or the pipeline"
          aria-label="Message"
          className="min-h-0 resize-none border-0 bg-transparent px-2 py-1.5 focus-visible:outline-none"
          style={{ maxHeight: MAX_HEIGHT }}
        />
        {streaming ? (
          <Button
            size="icon"
            variant="secondary"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      {showSuggestions && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => applySuggestion(s.prompt, s.label)}
                className={cn(
                  "flex items-start gap-2 rounded-panel border border-border bg-card px-3 py-2 text-left",
                  "transition-shadow duration-150 hover:shadow-card-hover"
                )}
              >
                {Icon && (
                  <Icon
                    className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span>
                  <span className="block text-[13px] font-medium">{s.label}</span>
                  {s.description && (
                    <span className="block text-[12px] text-muted-foreground">
                      {s.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[12px] text-muted-foreground">
        Replies are drafts. Review before anything reaches a client.
      </p>
    </div>
  );
}
