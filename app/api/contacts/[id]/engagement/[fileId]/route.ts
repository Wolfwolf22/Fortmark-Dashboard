import{requireCaller}from"@/lib/auth/require-caller";
import{actorOrResponse,contactsSource,failure,ID_SHAPE,unexpected}from"@/lib/contacts/http";
import{downloadContactEngagement}from"@/lib/contacts/engagement-service";
import{createContactEngagementStorage}from"@/lib/contacts/engagement-storage";
import{transactionAttachmentDownloadHeaders}from"@/lib/transactions/attachment-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string;fileId:string}>}){const caller=await requireCaller();if(!caller.ok)return caller.response;const{id,fileId}=await context.params;if(!ID_SHAPE.test(id)||!ID_SHAPE.test(fileId)||contactsSource()!=="db")return failure("not_found");const actor=await actorOrResponse(caller.clerkUserId);if(!actor.ok)return actor.response;try{const result=await downloadContactEngagement(actor.ctx,id,fileId,createContactEngagementStorage(process.env,{signal:request.signal}));return result.ok?new Response(result.value.stream,{headers:transactionAttachmentDownloadHeaders(result.value.filename,"application/pdf",result.value.sizeBytes)}):failure(result.reason);}catch(error){return unexpected(error);}}
