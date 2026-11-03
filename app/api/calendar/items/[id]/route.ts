import {NextResponse} from "next/server";
import {isRecordId} from "@/lib/db/ids";
import {personalCalendarCaller,personalCalendarFailure} from "@/lib/calendar/personal-http";
import {calendarUnexpected,CALENDAR_NO_STORE} from "@/lib/calendar/http";
import {getPersonalCalendarItem} from "@/lib/calendar/personal-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const caller=await personalCalendarCaller();if(!caller.ok)return caller.response;const{id}=await context.params;if(!isRecordId(id))return personalCalendarFailure("not_found");if(new URL(request.url).search)return personalCalendarFailure("invalid_personal_calendar");try{const result=await getPersonalCalendarItem(caller.ctx,id);return result.ok?NextResponse.json(result.value,{headers:CALENDAR_NO_STORE}):personalCalendarFailure(result.reason);}catch(error){return calendarUnexpected(error);}}
