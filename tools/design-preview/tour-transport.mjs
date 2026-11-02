import { getSampleTourContext, recommendSampleTour } from "./tour-model.mjs";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export async function tourTransport(path, url, input, init = {}) {
  const route = /^\/api\/showings\/([^/]+)\/tour$/.exec(path);
  if (!route) return undefined;
  const id = decodeURIComponent(route[1]), method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  try {
    if (method === "GET") return json(await getSampleTourContext(id, url.searchParams));
    if (method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if ([...url.searchParams.keys()].length) return json({ error: "invalid_tour_query" }, 400);
    const raw = init.body === undefined && input instanceof Request ? await input.text() : init.body;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 16384) return json({ error: "invalid_tour_plan" }, 400);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: "invalid_tour_plan" }, 400); }
    return json(await recommendSampleTour(id, body));
  } catch (error) { return json({ error: error.code || "preview_failure" }, error.status || 500); }
}
