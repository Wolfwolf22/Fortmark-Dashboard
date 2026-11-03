import{NextResponse}from"next/server";
import{requireCaller}from"@/lib/auth/require-caller";
import{actorOrResponse,contactsSource,failure,ID_SHAPE,NO_STORE,unexpected}from"@/lib/contacts/http";
import{getContactEngagement,uploadContactEngagement,removeContactEngagement}from"@/lib/contacts/engagement-service";
import{readContactEngagementForm,readContactLifecycleBody}from"@/lib/contacts/lifecycle-http";
import{createContactEngagementStorage}from"@/lib/contacts/engagement-storage";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
async function scoped(context:Context){const caller=await requireCaller();if(!caller.ok)return caller;const{id}=await context.params;if(!ID_SHAPE.test(id)||contactsSource()!=="db")return{ok:false as const,response:failure("not_found")};const actor=await actorOrResponse(caller.clerkUserId);return actor.ok?{ok:true as const,id,ctx:actor.ctx}:actor;}
export async function GET(_request:Request,context:Context){const actor=await scoped(context);if(!actor.ok)return actor.response;try{const result=await getContactEngagement(actor.ctx,actor.id);return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}}
export async function POST(request:Request,context:Context){const actor=await scoped(context);if(!actor.ok)return actor.response;if(actor.ctx.actor.role==="member")return failure("forbidden");try{const parsed=await readContactEngagementForm(request);if(!parsed.ok)return failure(parsed.reason);const result=await uploadContactEngagement(actor.ctx,actor.id,parsed.input,parsed.file,createContactEngagementStorage(process.env,{signal:request.signal}));return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}}
export async function DELETE(request:Request,context:Context){const actor=await scoped(context);if(!actor.ok)return actor.response;if(actor.ctx.actor.role==="member")return failure("forbidden");try{const result=await removeContactEngagement(actor.ctx,actor.id,await readContactLifecycleBody(request));return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}}
