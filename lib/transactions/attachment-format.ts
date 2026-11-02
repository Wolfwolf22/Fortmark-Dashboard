/** Bound and inspect the actual bytes; client filenames and MIME declarations confer no trust. */
export const MAX_TRANSACTION_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export type TransactionAttachmentContentType = "application/pdf" | "image/jpeg" | "image/png";
export function detectTransactionAttachment(bytes: Uint8Array): { contentType: TransactionAttachmentContentType; extension: "pdf" | "jpg" | "png" } | null {
  if (bytes.length < 12 || bytes.length > MAX_TRANSACTION_ATTACHMENT_BYTES) return null;
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 8));
  if (/^%PDF-(?:1\.[0-9]|2\.0)/.test(prefix) && /%%EOF[\s\0]*$/.test(new TextDecoder("ascii").decode(bytes.subarray(Math.max(0, bytes.length - 1024))))) return { contentType: "application/pdf", extension: "pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return { contentType: "image/jpeg", extension: "jpg" };
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 45 && png.every((value, index) => bytes[index] === value) && [0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index + 8] === value)
      && new DataView(bytes.buffer, bytes.byteOffset + 16, 8).getUint32(0) > 0 && new DataView(bytes.buffer, bytes.byteOffset + 16, 8).getUint32(4) > 0
      && [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((value, index) => bytes[bytes.length - 12 + index] === value)) return { contentType: "image/png", extension: "png" };
  return null;
}
export function normalizeTransactionAttachmentFilename(raw: string, extension: string): string {
  const base = raw.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || "Attachment";
  const stem = base.replace(/\.[^.]*$/, "").trim().slice(0, 150) || "Attachment";
  return `${stem}.${extension}`;
}
