import{NextResponse}from"next/server";
import{requireCaller}from"@/lib/auth/require-caller";
import{actorOrResponse,contactsSource,failure,ID_SHAPE,NO_STORE,unexpected}from"@/lib/contacts/http";
import{mutateContactDeletion}from"@/lib/contacts/lifecycle-service";
import{readContactLifecycleBody}from"@/lib/contacts/lifecycle-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const caller=await requireCaller();if(!caller.ok)return caller.response;const{id}=await context.params;if(!ID_SHAPE.test(id)||contactsSource()!=="db")return failure("not_found");const actor=await actorOrResponse(caller.clerkUserId);if(!actor.ok)return actor.response;if(actor.ctx.actor.role==="member")return failure("forbidden");try{const result=await mutateContactDeletion(actor.ctx,id,"restore",await readContactLifecycleBody(request));return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}}
