import{NextResponse}from"next/server";
import{requireCaller}from"@/lib/auth/require-caller";
import{actorOrResponse,contactsSource,failure,NO_STORE,unexpected}from"@/lib/contacts/http";
import{listDeletedContacts}from"@/lib/contacts/lifecycle-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){const caller=await requireCaller();if(!caller.ok)return caller.response;if(contactsSource()!=="db")return failure("not_found");const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>k!=="page")||params.getAll("page").length>1)return failure("invalid_request");const page=Number(params.get("page")??1);const actor=await actorOrResponse(caller.clerkUserId);if(!actor.ok)return actor.response;try{const result=await listDeletedContacts(actor.ctx,page);return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}}
