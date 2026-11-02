import { parseTransactionFilters } from "../../lib/transactions/filters.ts";
import { readTransactionWorkspaceQuery } from "../../lib/transactions/workspace-domain.ts";
import { listPreviewTransactions, getPreviewTransaction, getPreviewTransactionWorkspace, createPreviewTransaction, changePreviewTransactionStage, updatePreviewTransactionWorkspace, mutatePreviewTransactionDeadline, mutatePreviewTransactionChecklist } from "./transaction-model.mjs";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export async function transactionTransport(path, url, input, init = {}) {
  if (path !== "/api/transactions" && !path.startsWith("/api/transactions/")) return undefined;
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  try {
    if (path === "/api/transactions/source" && method === "GET") return json({ source: "db" });
    const route = /^\/api\/transactions\/([^/]+)(?:\/(workspace|deadlines|checklist|stage))?$/.exec(path);
    if (method === "GET") {
      if (path === "/api/transactions") { const { filters, range } = parseTransactionFilters(key => key === "q" ? null : url.searchParams.get(key)); return json({ items: listPreviewTransactions(filters, range) }); }
      if (!route) return json({ error: "not_found" }, 404);
      const id = decodeURIComponent(route[1]);
      if (route[2] === "workspace") { const query = readTransactionWorkspaceQuery(url.searchParams); if (!query) return json({ error: "invalid_transaction" }, 400); return json(getPreviewTransactionWorkspace(id, query)); }
      if (!route[2]) return json({ transaction: getPreviewTransaction(id) });
      return json({ error: "not_found" }, 404);
    }
    const raw = init.body === undefined && input instanceof Request ? await input.text() : init.body;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 131072) return json({ error: "invalid_transaction" }, 400);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: "invalid_transaction" }, 400); }
    if (path === "/api/transactions/search" && method === "POST") { if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_transaction" }, 400); const { filters, range } = parseTransactionFilters(key => typeof body[key] === "string" ? body[key] : null); return json({ items: listPreviewTransactions(filters, range) }); }
    if (path === "/api/transactions" && method === "POST") return json({ transaction: await createPreviewTransaction(body) }, 201);
    if (!route) return json({ error: "not_found" }, 404);
    const id = decodeURIComponent(route[1]);
    if (method === "PATCH" && route[2] === "workspace") return json(await updatePreviewTransactionWorkspace(id, body));
    if (method === "POST" && route[2] === "stage") return json({ transaction: await changePreviewTransactionStage(id, body) });
    if (method === "POST" && route[2] === "deadlines") return json(await mutatePreviewTransactionDeadline(id, body));
    if (method === "POST" && route[2] === "checklist") return json(await mutatePreviewTransactionChecklist(id, body));
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) { return json({ error: error.code || "preview_failure" }, error.status || 500); }
}
