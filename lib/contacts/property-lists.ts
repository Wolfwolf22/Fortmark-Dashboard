/** Named, private property lists. A contact association is optional; automatic matching is absent. */
import { z } from "zod";

export const PROPERTY_LIST_NAME_MAX = 120;
export const PROPERTY_LIST_PAGE_SIZE = 12;
export const MAX_PROPERTY_LIST_PAGE_SIZE = 24;
const name = z.string().trim().min(1).max(PROPERTY_LIST_NAME_MAX).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "Use a readable list name.");
export const createPropertyListInputSchema = z.object({ requestId: z.string().uuid(), name, contactId: z.string().uuid().optional() }).strict();
export const renamePropertyListInputSchema = z.object({ name, expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict();
export type CreatePropertyListInput = z.infer<typeof createPropertyListInputSchema>;
export type RenamePropertyListInput = z.infer<typeof renamePropertyListInputSchema>;
export const associatePropertyListInputSchema = z.object({ contactId: z.string().uuid().nullable(), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict();
export const sharePropertyListInputSchema = z.object({ userIds: z.array(z.string().uuid()).max(50).refine(ids => new Set(ids).size === ids.length), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict();
export type AssociatePropertyListInput = z.infer<typeof associatePropertyListInputSchema>;
export type SharePropertyListInput = z.infer<typeof sharePropertyListInputSchema>;
export interface PropertyListShareUser { id: string; name: string; role: string; active?: boolean }
export interface PropertyListSharing { listId: string; updatedAt: string; users: PropertyListShareUser[] }
export interface PropertyListView {
  id: string;
  name: string;
  contactId: string | null;
  contactName?: string;
  propertyCount: number;
  createdAt: string;
  updatedAt: string;
  isOwner?: boolean;
  canWrite?: boolean;
  sharedWithMe?: boolean;
  contactUnavailable?: boolean;
}
export interface PropertyListsPage { items: PropertyListView[]; total: number; page: number; pageSize: number }
export function readPropertyListsQuery(params: URLSearchParams): { page: number; pageSize: number; contactId?: string; scope?: "owned" | "shared" | "all" } | null {
  if ([...params.keys()].some(key => !["page", "pageSize", "contactId", "scope"].includes(key)) || [...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) return null;
  const rawPage = params.get("page"), rawSize = params.get("pageSize"), contactId = params.get("contactId");
  if ((rawPage !== null && !/^\d{1,7}$/.test(rawPage)) || (rawSize !== null && !/^\d{1,2}$/.test(rawSize))) return null;
  const page = rawPage === null ? 1 : Number(rawPage), pageSize = rawSize === null ? PROPERTY_LIST_PAGE_SIZE : Number(rawSize);
  if (page < 1 || page > 1_000_000 || pageSize < 1 || pageSize > MAX_PROPERTY_LIST_PAGE_SIZE || contactId !== null && !z.string().uuid().safeParse(contactId).success) return null;
  const scope = params.get("scope"); if (scope !== null && !["owned", "shared", "all"].includes(scope)) return null;
  return { page, pageSize, ...(contactId ? { contactId } : {}), ...(scope ? { scope: scope as "owned" | "shared" | "all" } : {}) };
}
