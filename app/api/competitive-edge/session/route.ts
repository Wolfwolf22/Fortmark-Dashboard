import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { resolveActor } from "@/lib/auth/actor";
import { getSession } from "@/lib/auth/session";
import { profileDatabaseEnabled } from "@/lib/flags";
export const dynamic="force-dynamic";
export async function GET() {
  const verified=await requireCaller();if(!verified.ok)return verified.response;
  const actor=await resolveActor(verified.clerkUserId,profileDatabaseEnabled());
  const headers={"Cache-Control":"private, no-store",Vary:"Cookie, Authorization"};
  if(!actor.ok)return NextResponse.json({error:"Workspace identity unavailable"},{status:actor.reason==="no_identity"?403:503,headers});
  const session=await getSession();
  if(!session || session.user.id!==verified.clerkUserId)return NextResponse.json({error:"Sign in required"},{status:401,headers});
  return NextResponse.json({userId:actor.actor.userId,displayName:session.user.name},{headers});
}
