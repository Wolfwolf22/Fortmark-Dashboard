import { getSampleShowing, getSampleShowings, getSampleShowingAgenda, getSampleShowingSummary, createSampleShowing, updateSampleShowing } from "./showing-model.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export async function showingTransport(path, url, input, init = {}) {
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  try {
    if (path === "/api/contacts/source" && method === "GET") return json({ source: "db" });
    if (path !== "/api/showings" && !path.startsWith("/api/showings/")) return undefined;
    if (method === "GET") {
      if (path === "/api/showings") return json(getSampleShowings(url.searchParams));
      if (path === "/api/showings/agenda") return json(getSampleShowingAgenda(url.searchParams));
      if (path === "/api/showings/summary") {
        if ([...url.searchParams.keys()].some(key => key !== "limit") || url.searchParams.getAll("limit").length > 1 || url.searchParams.has("limit") && !/^(?:[1-9]|1[0-2])$/.test(url.searchParams.get("limit"))) return json({ error: "invalid_showing_query" }, 400);
        return json(getSampleShowingSummary(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 3));
      }
      return json({ showing: getSampleShowing(decodeURIComponent(path.slice("/api/showings/".length))) });
    }
    const raw = init.body === undefined && input instanceof Request ? await input.text() : init.body;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 65536) return json({ error: "invalid_request" }, 400);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: "invalid_request" }, 400); }
    if (path === "/api/showings" && method === "POST") return json({ showing: createSampleShowing(body) }, 201);
    if (/^\/api\/showings\/[^/]+$/.test(path) && method === "PATCH") return json({ showing: updateSampleShowing(decodeURIComponent(path.slice("/api/showings/".length)), body) });
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) { return json({ error: error.code || "preview_failure", ...(error.fields?.length ? { fields: error.fields } : {}) }, error.status || 500); }
}
