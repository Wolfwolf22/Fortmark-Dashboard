import{NextResponse}from"next/server";
import{requireCaller}from"@/lib/auth/require-caller";
import{actorOrResponse,contactsSource,failure,ID_SHAPE,NO_STORE,unexpected}from"@/lib/contacts/http";
import{readHistoryQuery}from"@/lib/contacts/history";
import{getTouchHistoryPage}from"@/lib/contacts/history-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const caller=await requireCaller();if(!caller.ok)return caller.response;const{id}=await context.params;if(!ID_SHAPE.test(id)||contactsSource()!=="db")return failure("not_found");const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>k!=="cursor"&&k!=="pageSize"))return failure("invalid_request");const query=readHistoryQuery(params);if(!query)return failure("invalid_request");const actor=await actorOrResponse(caller.clerkUserId);if(!actor.ok)return actor.response;try{const result=await getTouchHistoryPage(actor.ctx,id,query);return result.ok?NextResponse.json(result.value,{headers:NO_STORE}):failure(result.reason);}catch(error){return unexpected(error);}}
