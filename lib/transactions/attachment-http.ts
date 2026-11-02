import "server-only";
import { MAX_TRANSACTION_ATTACHMENT_BYTES } from "./attachment-format.ts";
export async function readTransactionAttachmentForm(request: Request, itemId: string): Promise<{ ok: true; input: { itemId: string; requestId: string; expectedUpdatedAt: string; expectedItemUpdatedAt: string }; file: { name: string; bytes: Uint8Array } } | { ok: false; reason: "invalid_attachment" | "file_too_large" }> {
  const limit = MAX_TRANSACTION_ATTACHMENT_BYTES + 32768, contentType = request.headers.get("content-type") ?? "";
  if (!request.body || !/^multipart\/form-data\s*;/i.test(contentType)) return { ok: false, reason: "invalid_attachment" };
  if (Number(request.headers.get("content-length")) > limit) return { ok: false, reason: "file_too_large" };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); return { ok: false, reason: "file_too_large" }; } chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(), fields = ["file", "requestId", "expectedUpdatedAt", "expectedItemUpdatedAt"];
    if ([...form.keys()].some(key => !fields.includes(key)) || fields.some(key => form.getAll(key).length !== 1)) return { ok: false, reason: "invalid_attachment" };
    const file = form.get("file"), requestId = form.get("requestId"), expectedUpdatedAt = form.get("expectedUpdatedAt"), expectedItemUpdatedAt = form.get("expectedItemUpdatedAt");
    if (!file || typeof file === "string" || typeof requestId !== "string" || typeof expectedUpdatedAt !== "string" || typeof expectedItemUpdatedAt !== "string" || requestId.length > 40 || expectedUpdatedAt.length > 50 || expectedItemUpdatedAt.length > 50) return { ok: false, reason: "invalid_attachment" };
    if (file.size > MAX_TRANSACTION_ATTACHMENT_BYTES) return { ok: false, reason: "file_too_large" }; if (!file.size) return { ok: false, reason: "invalid_attachment" };
    return { ok: true, input: { itemId, requestId, expectedUpdatedAt, expectedItemUpdatedAt }, file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } };
  } catch { return { ok: false, reason: "invalid_attachment" }; } finally { reader.releaseLock(); }
}
export function transactionAttachmentDownloadHeaders(filename: string, contentType: string, sizeBytes: number): Record<string, string> {
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Content-Type": contentType, "Content-Length": String(sizeBytes), "Content-Disposition": `attachment; filename="Attachment"; filename*=UTF-8''${encoded}` };
}
