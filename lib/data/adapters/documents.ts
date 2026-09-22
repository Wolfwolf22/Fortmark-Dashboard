/**
 * Documents adapter.
 *
 * There is no document store and no e-signature provider. The filenames,
 * counts and signature states below are generated, so each read asks first
 * whether this deployment is in the labelled fixture mode; in ordinary mode
 * it is refused. "109 executed" is a claim about contracts that exist.
 */
import { DocumentStatus, TransactionDocument } from "../types";
import { documents } from "../mock/db";
import { now } from "@/lib/dates";
import { bumpDataVersion } from "../store";
import { delay } from "./latency";
import { requireSubsystem } from "./subsystems";

export interface DocumentFilters {
  status?: DocumentStatus[];
  transactionId?: string;
  query?: string;
}

export async function getDocuments(
  filters?: DocumentFilters
): Promise<TransactionDocument[]> {
  await requireSubsystem("documents");
  await delay();
  let result = [...documents];
  if (filters?.status?.length)
    result = result.filter((d) => filters.status!.includes(d.status));
  if (filters?.transactionId)
    result = result.filter((d) => d.transactionId === filters.transactionId);
  if (filters?.query) {
    const q = filters.query.toLowerCase();
    result = result.filter(
      (d) => d.name.toLowerCase().includes(q) || d.address.toLowerCase().includes(q)
    );
  }
  return result.sort((a, b) => b.updatedDate.localeCompare(a.updatedDate));
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus
): Promise<TransactionDocument | undefined> {
  await requireSubsystem("documents");
  await delay(150);
  const doc = documents.find((d) => d.id === id);
  if (!doc) return undefined;
  doc.status = status;
  doc.updatedDate = now().toISOString();
  bumpDataVersion();
  return doc;
}

/** The upload dropzone stub lands files here. */
export async function addDocument(
  input: Pick<TransactionDocument, "transactionId" | "address" | "name" | "kind">
): Promise<TransactionDocument> {
  await requireSubsystem("documents");
  await delay(300);
  const created: TransactionDocument = {
    id: `doc-upload-${documents.length + 1}`,
    status: "pendingSignature",
    updatedDate: now().toISOString(),
    ...input,
  };
  documents.unshift(created);
  bumpDataVersion();
  return created;
}
