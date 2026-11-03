import { NextResponse } from "next/server";
import { calendarCallerContext, calendarFailure, calendarUnexpected, readCalendarBody, CALENDAR_NO_STORE } from "@/lib/calendar/http";
import { calendarRescheduleInputSchema } from "@/lib/calendar/validation";
import { rescheduleCalendarItem } from "@/lib/calendar/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const caller = await calendarCallerContext(); if (!caller.ok) return caller.response;
  if (new URL(request.url).search) return calendarFailure("invalid_calendar_reschedule");
  if (!caller.ctx) return calendarFailure("not_configured"); if (caller.ctx.actor.role === "member") return calendarFailure("forbidden");
  const body = await readCalendarBody(request); if (!body.ok) return calendarFailure("invalid_calendar_reschedule"); const input = calendarRescheduleInputSchema.safeParse(body.body); if (!input.success) return calendarFailure("invalid_calendar_reschedule");
  try { const result = await rescheduleCalendarItem(caller.ctx, input.data, caller.availability); return result.ok ? NextResponse.json(result.value, { headers: CALENDAR_NO_STORE }) : calendarFailure(result.reason); } catch (error) { return calendarUnexpected(error); }
}
