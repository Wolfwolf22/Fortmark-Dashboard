import {NextResponse} from "next/server";
import {personalCalendarCaller,personalCalendarFailure} from "@/lib/calendar/personal-http";
import {readCalendarBody,calendarUnexpected,CALENDAR_NO_STORE} from "@/lib/calendar/http";
import {calendarLabelMutationSchema} from "@/lib/calendar/personal-validation";
import {getCalendarLabels,saveCalendarLabel} from "@/lib/calendar/personal-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){const caller=await personalCalendarCaller();if(!caller.ok)return caller.response;if(new URL(request.url).search)return personalCalendarFailure("invalid_calendar_label");try{const result=await getCalendarLabels(caller.ctx);return result.ok?NextResponse.json(result.value,{headers:CALENDAR_NO_STORE}):personalCalendarFailure(result.reason);}catch(error){return calendarUnexpected(error);}}
export async function POST(request:Request){const caller=await personalCalendarCaller(true);if(!caller.ok)return caller.response;if(new URL(request.url).search)return personalCalendarFailure("invalid_calendar_label");const body=await readCalendarBody(request);if(!body.ok)return personalCalendarFailure("invalid_calendar_label");const input=calendarLabelMutationSchema.safeParse(body.body);if(!input.success)return personalCalendarFailure("invalid_calendar_label");try{const result=await saveCalendarLabel(caller.ctx,input.data);return result.ok?NextResponse.json(result.value,{headers:CALENDAR_NO_STORE}):personalCalendarFailure(result.reason);}catch(error){return calendarUnexpected(error);}}
