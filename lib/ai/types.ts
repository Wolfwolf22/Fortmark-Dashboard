export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string; // ISO
  /** Per-message feedback state for the thumbs actions. */
  feedback?: "up" | "down" | null;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  messages: ChatMessage[];
}

export interface SendMessageOptions {
  signal?: AbortSignal;
  /** Model/mode selector value from the composer; forwarded to the provider later. */
  mode?: string;
}
