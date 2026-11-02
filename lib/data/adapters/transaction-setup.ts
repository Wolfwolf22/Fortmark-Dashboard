/** Approved brokerage vendors and admin-only defaults. Private text stays in JSON. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getTransactionSource, TransactionsError } from "./transactions";
import type { ChecklistAttachmentDefaults, ChecklistAttachmentDefaultInput } from "../../transactions/attachment-domain";
import type { BrokerageVendorDirectory, BrokerageVendorView, CreateBrokerageVendorInput, UpdateBrokerageVendorInput, VendorRole } from "../../transactions/vendor-domain";
async function requireSource() { if (await getTransactionSource() !== "db") throw new TransactionsError("sample_read_only", 403); }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await requireSource();
  const send = () => fetch(apiPath(path), { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (!init?.method) { let first: Response | null = null; try { first = await send(); } catch { /* One read retry. */ } response = !first || first.status === 502 || first.status === 504 ? await send() : first; } else response = await send();
  if (!response.ok) { let code = "unknown"; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; } catch { /* Status remains authoritative. */ } throw new TransactionsError(code, response.status); }
  return response.json() as Promise<T>;
}
export async function getChecklistAttachmentDefaults(): Promise<ChecklistAttachmentDefaults> { return request("/api/transactions/setup/checklist"); }
export async function updateChecklistAttachmentDefault(input: ChecklistAttachmentDefaultInput): Promise<ChecklistAttachmentDefaults> { await requireSource(); try { return await request("/api/transactions/setup/checklist", { method: "PATCH", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function getBrokerageVendors(role?: VendorRole): Promise<BrokerageVendorDirectory> { return request(`/api/vendors${role ? `?${new URLSearchParams({ role })}` : ""}`); }
export async function createBrokerageVendor(input: CreateBrokerageVendorInput): Promise<BrokerageVendorView> { await requireSource(); try { return await request("/api/vendors", { method: "POST", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
export async function updateBrokerageVendor(id: string, input: UpdateBrokerageVendorInput): Promise<BrokerageVendorView> { await requireSource(); try { return await request(`/api/vendors/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
