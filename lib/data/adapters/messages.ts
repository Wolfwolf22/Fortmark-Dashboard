/**
 * Messages adapter.
 *
 * There is no messaging backend. The threads below are generated — named
 * people, quoted sentences, an unread count — so each read asks first
 * whether this deployment is in the labelled fixture mode; in ordinary mode
 * it is refused. A message nobody sent is the worst thing this product
 * could show, because someone would reply to it.
 */
import { MessageThread, ThreadMessage } from "../types";
import { messageThreads } from "../mock/db";
import { now } from "@/lib/dates";
import { bumpDataVersion } from "../store";
import { delay } from "./latency";
import { requireSubsystem } from "./subsystems";

export async function getThreads(): Promise<MessageThread[]> {
  await requireSubsystem("messages");
  await delay();
  return [...messageThreads].sort((a, b) =>
    b.lastMessageDate.localeCompare(a.lastMessageDate)
  );
}

export async function getThread(id: string): Promise<MessageThread | undefined> {
  await requireSubsystem("messages");
  await delay(100);
  return messageThreads.find((t) => t.id === id);
}

export async function sendThreadMessage(
  threadId: string,
  body: string
): Promise<ThreadMessage | undefined> {
  await requireSubsystem("messages");
  await delay(200);
  const thread = messageThreads.find((t) => t.id === threadId);
  if (!thread) return undefined;
  const message: ThreadMessage = {
    id: `msg-${threadId}-${thread.messages.length + 1}`,
    from: "me",
    body,
    date: now().toISOString(),
  };
  thread.messages.push(message);
  thread.lastMessageDate = message.date;
  bumpDataVersion();
  return message;
}

export async function markThreadRead(threadId: string): Promise<void> {
  await requireSubsystem("messages");
  const thread = messageThreads.find((t) => t.id === threadId);
  if (thread && thread.unread) {
    thread.unread = false;
    bumpDataVersion();
  }
}
