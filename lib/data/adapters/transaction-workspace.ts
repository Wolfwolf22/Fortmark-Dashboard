/** Transaction file reads and explicit, revision-checked writes. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getTransactionSource, TransactionsError } from "./transactions";
import type { TransactionWorkspace, TransactionDeadlineMutation, UpdateTransactionWorkspaceInput } from "../../transactions/workspace-domain";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = () => fetch(apiPath(path), { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (!init?.method) { let first: Response | null = null; try { first = await send(); } catch { /* One safe read retry. */ } response = !first || first.status === 502 || first.status === 504 ? await send() : first; } else response = await send();
  if (!response.ok) { let code = "unknown"; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; } catch { /* Status remains authoritative. */ } throw new TransactionsError(code, response.status); }
  return response.json() as Promise<T>;
}
async function requireSource() { if (await getTransactionSource() !== "db") throw new TransactionsError("sample_read_only", 403); }
export async function getTransactionWorkspace(id: string, options?: { historyPage?: number }): Promise<TransactionWorkspace> { await requireSource(); return request(`/api/transactions/${encodeURIComponent(id)}/workspace?${new URLSearchParams({ historyPage: String(options?.historyPage ?? 1) })}`); }
export async function updateTransactionWorkspace(id: string, input: UpdateTransactionWorkspaceInput): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/workspace`, { method: "PATCH", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function mutateTransactionDeadline(id: string, input: TransactionDeadlineMutation): Promise<TransactionWorkspace> { await requireSource(); try { return await request(`/api/transactions/${encodeURIComponent(id)}/deadlines`, { method: "POST", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
