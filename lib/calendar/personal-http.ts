import "server-only";
import { NextResponse } from "next/server";
import { calendarCallerContext,CALENDAR_NO_STORE } from "./http.ts";
import type { PersonalCalendarFailure } from "./personal-service.ts";
export async function personalCalendarCaller(write=false){const caller=await calendarCallerContext();if(!caller.ok)return caller;if(!caller.ctx||!caller.availability.personal)return{ok:false as const,response:personalCalendarFailure("not_configured")};if(write&&caller.ctx.actor.role==="member")return{ok:false as const,response:personalCalendarFailure("forbidden")};return{ok:true as const,ctx:caller.ctx,availability:caller.availability};}
export function personalCalendarFailure(reason:PersonalCalendarFailure){return NextResponse.json({error:reason},{status:reason.startsWith("invalid_")&&reason!=="invalid_transition"?400:reason==="not_found"?404:reason==="forbidden"?403:reason==="not_configured"||reason==="unavailable"?503:409,headers:CALENDAR_NO_STORE});}
