import { getPreviewCalendar, reschedulePreviewCalendar } from './calendar-model.mjs';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export async function calendarTransport(path, url, input, init = {}) {
  if (path !== '/api/calendar' && path !== '/api/calendar/reschedule') return undefined;
  const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
  try {
    if (path === '/api/calendar' && method === 'GET') return json(getPreviewCalendar(url.searchParams));
    if (path === '/api/calendar/reschedule' && method === 'POST') {
      if (url.search) return json({ error: 'invalid_calendar_reschedule' }, 400);
      const raw = init.body === undefined && input instanceof Request ? await input.text() : init.body;
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 65536) return json({ error: 'invalid_calendar_reschedule' }, 400);
      let value; try { value = JSON.parse(raw); } catch { return json({ error: 'invalid_calendar_reschedule' }, 400); }
      return json(await reschedulePreviewCalendar(value));
    }
    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) { return json({ error: error.code || 'preview_failure' }, error.status || 500); }
}
