"use client";

/**
 * Assistant replies render as markdown. Every element wears semantic tokens
 * so the transcript reads identically in both themes — no prose plugin, no
 * hardcoded color.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mb-2 mt-5 text-[15px] font-bold first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-5 text-[15px] font-bold first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-4 text-sm font-semibold first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="mb-3 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="font-medium underline underline-offset-2 hover:text-muted-foreground"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          code: ({ className: cls, children, ...props }) => {
            // Fenced blocks arrive with a language class; inline code does not.
            const isBlock = /language-/.test(cls ?? "");
            if (!isBlock) {
              return (
                <code
                  className="rounded bg-tint px-1 py-0.5 text-[12.5px] tabular"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className="block text-[12.5px] leading-relaxed" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-panel bg-tint p-3 last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-[13px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="text-micro whitespace-nowrap px-2 py-1.5 text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-2 py-1.5 tabular">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
