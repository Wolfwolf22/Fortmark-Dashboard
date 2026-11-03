import {NextResponse} from "next/server";
import {personalCalendarCaller,personalCalendarFailure} from "@/lib/calendar/personal-http";
import {readCalendarBody,calendarUnexpected,CALENDAR_NO_STORE} from "@/lib/calendar/http";
import {calendarAnnotationMutationSchema} from "@/lib/calendar/personal-validation";
import {updateCalendarAnnotation} from "@/lib/calendar/personal-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function PUT(request:Request){const caller=await personalCalendarCaller(true);if(!caller.ok)return caller.response;if(new URL(request.url).search)return personalCalendarFailure("invalid_calendar_annotation");const body=await readCalendarBody(request);if(!body.ok)return personalCalendarFailure("invalid_calendar_annotation");const input=calendarAnnotationMutationSchema.safeParse(body.body);if(!input.success)return personalCalendarFailure("invalid_calendar_annotation");try{const result=await updateCalendarAnnotation(caller.ctx,input.data,caller.availability);return result.ok?NextResponse.json(result.value,{headers:CALENDAR_NO_STORE}):personalCalendarFailure(result.reason);}catch(error){return calendarUnexpected(error);}}
