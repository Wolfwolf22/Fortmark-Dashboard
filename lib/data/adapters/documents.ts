/**
 * Documents adapter. Mock-backed today; swap the bodies for document storage
 * and e-signature providers and the UI is untouched.
 */
import { DocumentStatus, TransactionDocument } from "../types";
import { documents, now } from "../mock/db";
import { bumpDataVersion } from "../store";
import { delay } from "./latency";

export interface DocumentFilters {
  status?: DocumentStatus[];
  transactionId?: string;
  query?: string;
}

export async function getDocuments(
  filters?: DocumentFilters
): Promise<TransactionDocument[]> {
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
