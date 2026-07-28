"use client";

/**
 * Conversation history. Threads persist to localStorage under
 * `fm.ai.threads.v1` — the same shape a server-backed thread store would
 * return, so swapping this for an API is a one-file change.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ChatMessage, ChatRole, ChatThread } from "./types";

/** Thread titles come from the first user message, trimmed to a line. */
export const UNTITLED = "New conversation";

function titleFrom(content: string): string {
  const line = content.replace(/\s+/g, " ").trim();
  if (!line) return UNTITLED;
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

/**
 * Ids are counter-based rather than random so a server render and the first
 * client render never disagree. The counter is seeded past anything already
 * persisted when the store rehydrates.
 */
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

interface AiState {
  threads: ChatThread[];
  activeId: string | null;

  /** Creates an empty thread and makes it active. Returns its id. */
  newThread: () => string;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  clearAll: () => void;

  /** Appends a message to `threadId`, returning the new message id. */
  addMessage: (threadId: string, role: ChatRole, content: string) => string;
  /** Replaces a message's content — used to grow the streaming reply. */
  updateMessage: (threadId: string, messageId: string, content: string) => void;
  removeMessage: (threadId: string, messageId: string) => void;
  setFeedback: (
    threadId: string,
    messageId: string,
    feedback: "up" | "down" | null
  ) => void;
}

function touch(thread: ChatThread, iso: string): ChatThread {
  return { ...thread, updatedAt: iso };
}

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeId: null,

      newThread: () => {
        const iso = new Date().toISOString();
        const thread: ChatThread = {
          id: nextId("thread"),
          title: UNTITLED,
          createdAt: iso,
          updatedAt: iso,
          messages: [],
        };
        set((s) => ({ threads: [thread, ...s.threads], activeId: thread.id }));
        return thread.id;
      },

      selectThread: (activeId) => set({ activeId }),

      deleteThread: (id) =>
        set((s) => {
          const threads = s.threads.filter((t) => t.id !== id);
          const activeId =
            s.activeId === id ? threads[0]?.id ?? null : s.activeId;
          return { threads, activeId };
        }),

      renameThread: (id, title) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === id ? { ...t, title: title.trim() || UNTITLED } : t
          ),
        })),

      clearAll: () => set({ threads: [], activeId: null }),

      addMessage: (threadId, role, content) => {
        const id = nextId("msg");
        const iso = new Date().toISOString();
        const message: ChatMessage = {
          id,
          role,
          content,
          createdAt: iso,
          feedback: null,
        };
        set((s) => ({
          threads: s.threads.map((t) => {
            if (t.id !== threadId) return t;
            // The first user message names the thread.
            const title =
              t.title === UNTITLED && role === "user"
                ? titleFrom(content)
                : t.title;
            return touch(
              { ...t, title, messages: [...t.messages, message] },
              iso
            );
          }),
        }));
        return id;
      },

      updateMessage: (threadId, messageId, content) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId ? { ...m, content } : m
                  ),
                }
              : t
          ),
        })),

      removeMessage: (threadId, messageId) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? { ...t, messages: t.messages.filter((m) => m.id !== messageId) }
              : t
          ),
        })),

      setFeedback: (threadId, messageId, feedback) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId ? { ...m, feedback } : m
                  ),
                }
              : t
          ),
        })),
    }),
    {
      name: "fm.ai.threads.v1",
      partialize: (s) => ({ threads: s.threads, activeId: s.activeId }),
      onRehydrateStorage: () => (state) => {
        // Continue the id sequence past anything already on disk, so a
        // restored session cannot mint a colliding id.
        if (!state) return;
        let max = 0;
        for (const thread of state.threads) {
          max = Math.max(max, idNumber(thread.id));
          for (const message of thread.messages) {
            max = Math.max(max, idNumber(message.id));
          }
        }
        seq = Math.max(seq, max);
      },
    }
  )
);

function idNumber(id: string): number {
  const n = Number.parseInt(id.slice(id.lastIndexOf("-") + 1), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Convenience selector: the currently open thread, if any. */
export function useActiveThread(): ChatThread | undefined {
  return useAiStore((s) => s.threads.find((t) => t.id === s.activeId));
}
