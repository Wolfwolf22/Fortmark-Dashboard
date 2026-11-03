import "server-only";
import { MAX_TRANSACTION_ATTACHMENT_BYTES } from "./attachment-format.ts";
import { VENDOR_ATTACHMENT_KINDS, type TransactionVendorDetailUploadInput } from "./vendor-detail-domain.ts";

/** Parse bounded bytes before invoking storage. Client MIME, paths, and identity snapshots are ignored. */
export async function readVendorAttachmentForm(request: Request): Promise<{ ok: true; input: TransactionVendorDetailUploadInput; file: { name: string; bytes: Uint8Array } } | { ok: false; reason: "invalid_attachment" | "file_too_large" }> {
  const limit = MAX_TRANSACTION_ATTACHMENT_BYTES + 32768, contentType = request.headers.get("content-type") ?? "";
  if (!request.body || !/^multipart\/form-data\s*;/i.test(contentType)) return { ok: false, reason: "invalid_attachment" };
  if (Number(request.headers.get("content-length")) > limit) return { ok: false, reason: "file_too_large" };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); return { ok: false, reason: "file_too_large" }; } chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(), fields = ["file", "requestId", "expectedUpdatedAt", "expectedDetailUpdatedAt", "kind"];
    if ([...form.keys()].some(key => !fields.includes(key)) || fields.some(key => form.getAll(key).length !== 1)) return { ok: false, reason: "invalid_attachment" };
    const file = form.get("file"), requestId = form.get("requestId"), expectedUpdatedAt = form.get("expectedUpdatedAt"), expectedDetailUpdatedAt = form.get("expectedDetailUpdatedAt"), kind = form.get("kind");
    if (!file || typeof file === "string" || typeof requestId !== "string" || typeof expectedUpdatedAt !== "string" || typeof expectedDetailUpdatedAt !== "string" || typeof kind !== "string" || requestId.length > 40 || expectedUpdatedAt.length > 50 || expectedDetailUpdatedAt.length > 50 || !VENDOR_ATTACHMENT_KINDS.includes(kind as never)) return { ok: false, reason: "invalid_attachment" };
    if (file.size > MAX_TRANSACTION_ATTACHMENT_BYTES) return { ok: false, reason: "file_too_large" }; if (!file.size) return { ok: false, reason: "invalid_attachment" };
    return { ok: true, input: { requestId, expectedUpdatedAt, expectedDetailUpdatedAt, kind: kind as TransactionVendorDetailUploadInput["kind"] }, file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } };
  } catch { return { ok: false, reason: "invalid_attachment" }; } finally { reader.releaseLock(); }
}
