import { NextResponse } from "next/server";
import { calendarCallerContext, calendarFailure, calendarUnexpected, CALENDAR_NO_STORE } from "@/lib/calendar/http";
import { readCalendarQuery } from "@/lib/calendar/scheduling";
import { getInternalCalendar } from "@/lib/calendar/service";
import { CALENDAR_KINDS, CALENDAR_TIME_ZONE, type CalendarPage } from "@/lib/calendar/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const caller = await calendarCallerContext(); if (!caller.ok) return caller.response;
  const query = readCalendarQuery(new URL(request.url).searchParams); if (!query) return calendarFailure("invalid_calendar_query");
  try { if (!caller.ctx) { const page: CalendarPage = { items: [], sources: (query.kinds ?? CALENDAR_KINDS).map(kind => ({ kind, status: "not_configured", truncated: false, total: null })), fromDay: query.fromDay, toDay: query.toDay, timeZone: CALENDAR_TIME_ZONE, generatedAt: new Date().toISOString(),labels:[],labelsStatus:"not_configured" }; return NextResponse.json(page, { headers: CALENDAR_NO_STORE }); }
    const result = await getInternalCalendar(caller.ctx, query, caller.availability); return result.ok ? NextResponse.json(result.value, { headers: CALENDAR_NO_STORE }) : calendarFailure(result.reason);
  } catch (error) { return calendarUnexpected(error); }
}
