import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { resolveActor } from "@/lib/auth/actor";
import { profileDatabaseEnabled } from "@/lib/flags";
import { namespaceSchema, workspaceWriteSchema, MAX_WORKSPACE_BYTES } from "@/lib/workspaces/contract";
import { readWorkspace, writeWorkspace } from "@/lib/workspaces/service";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store",Vary:"Cookie, Authorization"};
const fail=(message:string,status:number)=>NextResponse.json({error:message},{status,headers});
async function caller() {
  const verified=await requireCaller();if(!verified.ok)return verified;
  const result=await resolveActor(verified.clerkUserId,profileDatabaseEnabled());
  return result.ok ? result : {ok:false as const,response:fail("Personal workspace unavailable",result.reason==="no_identity"?403:503)};
}
export async function GET(request:Request) {
  const verified=await caller();if(!verified.ok)return verified.response;
  const namespace=namespaceSchema.safeParse(new URL(request.url).searchParams.get("namespace"));
  if(!namespace.success)return fail("Choose a supported workspace",400);
  try { return NextResponse.json({...await readWorkspace(verified.db,verified.actor,namespace.data),userId:verified.actor.userId},{headers}); }
  catch {return fail("Personal workspace could not be loaded",503);}
}
export async function PUT(request:Request) {
  const verified=await caller();if(!verified.ok)return verified.response;
  // Same-origin JSON only. No form posts, reflected origins or user identifiers.
  if(request.headers.get("origin")!=="https://app.fortmark.net" || !request.headers.get("content-type")?.startsWith("application/json"))return fail("Forbidden",403);
  try {
    const reader=request.body?.getReader();if(!reader)return fail("Request required",400);
    const chunks:Uint8Array[]=[];let length=0;
    try { for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>MAX_WORKSPACE_BYTES+10000){await reader.cancel();return fail("Workspace is too large",413);}chunks.push(chunk.value);} }finally{reader.releaseLock();}
    let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return fail("Invalid JSON",400);}
    const parsed=workspaceWriteSchema.safeParse(body);
    if(!parsed.success)return fail("Invalid personal workspace",400);
    if(parsed.data.accountId!==verified.actor.userId)return fail("Your signed-in account changed. Reload before saving.",409);
    const saved=await writeWorkspace(verified.db,verified.actor,parsed.data.namespace,parsed.data.revision,parsed.data.data);
    if(!saved)return fail("Your workspace changed in another tab or device. Reload before saving.",409);
    return NextResponse.json({...saved,userId:verified.actor.userId},{headers});
  } catch { return fail("Personal workspace could not be saved",503); }
}
