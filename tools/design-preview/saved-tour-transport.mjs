import { getSampleSavedTours, getSampleSavedTour, createSampleSavedTour, updateSampleSavedTour, archiveSampleSavedTour, reviewSampleSavedTour, scheduleSampleSavedTour } from "./saved-tour-model.mjs";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export async function savedTourTransport(path, url, input, init = {}) {
  if (path !== "/api/showing-tours" && !path.startsWith("/api/showing-tours/")) return undefined;
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase(), route = /^\/api\/showing-tours\/([^/]+)(?:\/(archive|review|schedule))?$/.exec(path);
  try {
    if (method === "GET") {
      if (path === "/api/showing-tours") return json(getSampleSavedTours(url.searchParams));
      if (route && !route[2]) return json({ tour: getSampleSavedTour(decodeURIComponent(route[1])) });
      return json({ error: "not_found" }, 404);
    }
    const raw = init.body === undefined && input instanceof Request ? await input.text() : init.body;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 65536) return json({ error: "invalid_saved_tour" }, 400);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: "invalid_saved_tour" }, 400); }
    if (method === "POST" && path === "/api/showing-tours") return json({ tour: await createSampleSavedTour(body) }, 201);
    if (!route) return json({ error: "not_found" }, 404);
    const id = decodeURIComponent(route[1]);
    if (method === "PATCH" && !route[2]) return json({ tour: await updateSampleSavedTour(id, body) });
    if (method === "POST" && route[2] === "archive") return json({ tour: await archiveSampleSavedTour(id, body) });
    if (method === "POST" && route[2] === "review") return json(await reviewSampleSavedTour(id, body));
    if (method === "POST" && route[2] === "schedule") return json(await scheduleSampleSavedTour(id, body));
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) { return json({ error: error.code || "preview_failure" }, error.status || 500); }
}
