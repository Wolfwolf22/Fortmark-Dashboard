/** Transaction file reads and explicit, revision-checked writes. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getTransactionSource, TransactionsError } from "./transactions";
import type { TransactionAttachmentUploadInput, TransactionAttachmentRemoveInput, TransactionAttachmentRequirementInput } from "../../transactions/attachment-domain";
import type { TransactionVendorMutation } from "../../transactions/vendor-domain";
import type { TransactionChecklistMutation } from "../../transactions/checklist-domain";
import type { TransactionWorkspace, TransactionDeadlineMutation, UpdateTransactionWorkspaceInput } from "../../transactions/workspace-domain";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = () => fetch(apiPath(path), { ...init, headers: { Accept: "application/json", ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (!init?.method) { let first: Response | null = null; try { first = await send(); } catch { /* One safe read retry. */ } response = !first || first.status === 502 || first.status === 504 ? await send() : first; } else response = await send();
  if (!response.ok) { let code = "unknown"; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; } catch { /* Status remains authoritative. */ } throw new TransactionsError(code, response.status); }
  return response.json() as Promise<T>;
}
async function requireSource() { if (await getTransactionSource() !== "db") throw new TransactionsError("sample_read_only", 403); }
export async function getTransactionWorkspace(id: string, options?: { historyPage?: number }): Promise<TransactionWorkspace> { await requireSource(); return request(`/api/transactions/${encodeURIComponent(id)}/workspace?${new URLSearchParams({ historyPage: String(options?.historyPage ?? 1) })}`); }
export async function updateTransactionWorkspace(id: string, input: UpdateTransactionWorkspaceInput): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/workspace`, { method: "PATCH", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function mutateTransactionDeadline(id: string, input: TransactionDeadlineMutation): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/deadlines`, { method: "POST", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }

export async function mutateTransactionChecklist(id: string, input: TransactionChecklistMutation): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/checklist`, { method: "POST", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }

export async function uploadTransactionAttachment(id: string, input: TransactionAttachmentUploadInput, file: File): Promise<TransactionWorkspace> {
  await requireSource(); const form = new FormData(); form.append("file", file, file.name); form.append("requestId", input.requestId); form.append("expectedUpdatedAt", input.expectedUpdatedAt); form.append("expectedItemUpdatedAt", input.expectedItemUpdatedAt);
  try { return await request(`/api/transactions/${encodeURIComponent(id)}/checklist/${encodeURIComponent(input.itemId)}/attachments`, { method: "POST", body: form }); } finally { bumpDataVersion(); }
}
export async function removeTransactionAttachment(id: string, attachmentId: string, input: TransactionAttachmentRemoveInput): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function updateTransactionAttachmentRequirement(id: string, input: TransactionAttachmentRequirementInput): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/checklist/requirements`, { method: "PATCH", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function updateTransactionVendor(id: string, input: TransactionVendorMutation): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/vendors`, { method: "POST", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function downloadTransactionAttachment(id: string, attachmentId: string): Promise<Blob> {
  await requireSource(); const send = () => fetch(apiPath(`/api/transactions/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`), { headers: { Accept: "application/pdf, image/jpeg, image/png" } });
  let first: Response | null = null; try { first = await send(); } catch { /* One authorized read retry. */ } const response = !first || first.status === 502 || first.status === 504 ? await send() : first;
  if (!response.ok) { let code = "unknown"; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; } catch { /* Keep authoritative status. */ } throw new TransactionsError(code, response.status); }
  return response.blob();
}
