import { MessageThread } from "@/lib/data/types";

/** Participant role labels, sentence case per the copy rules. */
export const PARTICIPANT_ROLE_LABELS: Record<
  MessageThread["participantRole"],
  string
> = {
  client: "Client",
  agent: "Agent",
  lender: "Lender",
  inspector: "Inspector",
  title: "Title",
};

export const PARTICIPANT_ROLES = Object.keys(
  PARTICIPANT_ROLE_LABELS
) as MessageThread["participantRole"][];

/** Last line of a thread, for the list preview. */
export function previewOf(thread: MessageThread): string {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return "No messages yet";
  const body = last.body.replace(/\s+/g, " ").trim();
  return last.from === "me" ? `You: ${body}` : body;
}
