import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse,failure,NO_STORE,transactionsSource,unexpected,readTransactionBody } from "@/lib/transactions/http";
import { mutateTransactionWorkflow } from "@/lib/transactions/workflow-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const caller=await requireCaller();if(!caller.ok)return caller.response;
 const {id}=await context.params;if(!isRecordId(id)||transactionsSource()!=="db")return failure("not_found");
 if([...new URL(request.url).searchParams.keys()].length)return failure("invalid_workflow");
 const actor=await actorOrResponse(caller.clerkUserId);if(!actor.ok)return actor.response;if(actor.ctx.actor.role==="member")return failure("forbidden");
 const body=await readTransactionBody(request);if(!body.ok)return failure("invalid_workflow");
 try{const result=await mutateTransactionWorkflow(actor.ctx,id,body.body);return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}
}
