import { getPreviewCalendar, reschedulePreviewCalendar, previewCalendarAnnotationTarget } from './calendar-model.mjs';
import { getPreviewCalendarLabels, mutatePreviewCalendarLabel, getPreviewPersonalCalendarRecord, mutatePreviewPersonalCalendar, mutatePreviewCalendarAnnotation } from './personal-calendar-model.mjs';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export async function calendarTransport(path, url, input, init = {}) {
  const itemMatch=/^\/api\/calendar\/items\/([^/]+)$/.exec(path);
  if (!['/api/calendar','/api/calendar/reschedule','/api/calendar/items','/api/calendar/labels','/api/calendar/annotation'].includes(path)&&!itemMatch) return undefined;
  const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
  try {
    if (path === '/api/calendar' && method === 'GET') return json(getPreviewCalendar(url.searchParams));
    const errorCode=path==='/api/calendar/items'?'invalid_personal_calendar':path==='/api/calendar/labels'?'invalid_calendar_label':path==='/api/calendar/annotation'?'invalid_calendar_annotation':'invalid_calendar_reschedule';
    if(url.search)return json({error:errorCode},400);
    if(itemMatch&&method==='GET')return json(getPreviewPersonalCalendarRecord(decodeURIComponent(itemMatch[1])));
    if(path==='/api/calendar/labels'&&method==='GET')return json(getPreviewCalendarLabels());
    if ((['/api/calendar/reschedule','/api/calendar/items','/api/calendar/labels'].includes(path)&&method==='POST')||(path==='/api/calendar/annotation'&&method==='PUT')) {
      const raw = init.body === undefined && input instanceof Request ? await input.text() : init.body;
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 65536) return json({ error: errorCode }, 400);
      let value; try { value = JSON.parse(raw); } catch { return json({ error: errorCode }, 400); }
      return json(path==='/api/calendar/items'?await mutatePreviewPersonalCalendar(value):path==='/api/calendar/labels'?await mutatePreviewCalendarLabel(value):path==='/api/calendar/annotation'?await mutatePreviewCalendarAnnotation(value,previewCalendarAnnotationTarget):await reschedulePreviewCalendar(value));
    }
    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) { return json({ error: error.code || 'preview_failure' }, error.status || 500); }
}
