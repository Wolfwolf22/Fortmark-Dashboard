/**
 * Messages adapter. Mock-backed today; swap the bodies for the messaging
 * backend and the UI is untouched.
 */
import { MessageThread, ThreadMessage } from "../types";
import { messageThreads, now } from "../mock/db";
import { bumpDataVersion } from "../store";
import { delay } from "./latency";

export async function getThreads(): Promise<MessageThread[]> {
  await delay();
  return [...messageThreads].sort((a, b) =>
    b.lastMessageDate.localeCompare(a.lastMessageDate)
  );
}

export async function getThread(id: string): Promise<MessageThread | undefined> {
  await delay(100);
  return messageThreads.find((t) => t.id === id);
}

export async function sendThreadMessage(
  threadId: string,
  body: string
): Promise<ThreadMessage | undefined> {
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
  const thread = messageThreads.find((t) => t.id === threadId);
  if (thread && thread.unread) {
    thread.unread = false;
    bumpDataVersion();
  }
}
