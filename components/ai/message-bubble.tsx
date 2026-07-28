"use client";

import * as React from "react";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { Markdown } from "./markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatMessage } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

/**
 * One turn in the transcript. User turns are a tinted block on the right;
 * assistant turns are full-width markdown with actions beneath.
 */
export function MessageBubble({
  message,
  streaming = false,
  onFeedback,
}: {
  message: ChatMessage;
  /** True while this message is still receiving tokens. */
  streaming?: boolean;
  onFeedback?: (feedback: "up" | "down" | null) => void;
}) {
  const [copied, setCopied] = React.useState(false);

  // Reset the "Copied" affordance shortly after it fires.
  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; leave the button silent rather than
      // claiming a copy that did not happen.
    }
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-panel bg-tint px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  const empty = message.content.length === 0;

  return (
    <div className="group/message">
      {empty && streaming ? (
        <ThinkingDots />
      ) : (
        <Markdown content={message.content} />
      )}

      {/* Actions appear once the reply is complete. */}
      {!streaming && !empty && (
        <div className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="muted"
                size="icon-sm"
                onClick={copy}
                aria-label={copied ? "Copied" : "Copy reply"}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copied" : "Copy reply"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="muted"
                size="icon-sm"
                aria-label="Helpful"
                aria-pressed={message.feedback === "up"}
                onClick={() =>
                  onFeedback?.(message.feedback === "up" ? null : "up")
                }
                className={cn(message.feedback === "up" && "text-foreground")}
              >
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Helpful</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="muted"
                size="icon-sm"
                aria-label="Not helpful"
                aria-pressed={message.feedback === "down"}
                onClick={() =>
                  onFeedback?.(message.feedback === "down" ? null : "down")
                }
                className={cn(message.feedback === "down" && "text-foreground")}
              >
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Not helpful</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/** Pre-first-token state: three quiet dots, no spinner. */
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  );
}
