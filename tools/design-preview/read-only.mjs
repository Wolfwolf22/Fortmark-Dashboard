export const PREVIEW_WRITE_EVENT = "fortmark-preview-write-blocked";
export function announceReadOnly() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(PREVIEW_WRITE_EVENT));
  }
}
export function rejectPreviewWrite() {
  announceReadOnly();
  return Promise.reject(new Error("Design preview is read-only. No records were changed."));
}
