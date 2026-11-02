import { VENDOR_ROLES } from "../../lib/transactions/vendor-domain.ts";
import { previewChecklistDefaults, updatePreviewChecklistDefault, setPreviewAttachmentRequirement, uploadPreviewChecklistAttachment, downloadPreviewChecklistAttachment, removePreviewChecklistAttachment, listPreviewVendors, createPreviewVendor, updatePreviewVendor, mutatePreviewVendorSelection } from "./transaction-operations.mjs";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"private, no-store"}});
export async function transactionOperationsTransport(path,url,input,init={}) {
  const match=/^\/api\/transactions\/([^/]+)\/(vendors|checklist\/requirements|attachments\/([^/]+)|checklist\/([^/]+)\/attachments)$/.exec(path), vendor=/^\/api\/vendors\/([^/]+)$/.exec(path), setup=path==="/api/transactions/setup/checklist";
  if(!match&&!vendor&&!setup&&path!=="/api/vendors")return undefined;
  const method=(init.method||(typeof input==="object"&&input.method)||"GET").toUpperCase();
  try {
    if(method==="GET"){
      if(path==="/api/vendors"){const role=url.searchParams.get("role");if([...url.searchParams.keys()].some(k=>k!=="role")||url.searchParams.getAll("role").length>1||role&&!VENDOR_ROLES.includes(role))return json({error:"invalid_transaction"},400);return json(listPreviewVendors(role));}
      if(url.search)return json({error:"invalid_transaction"},400);
      if(setup)return json(previewChecklistDefaults());
      if(match?.[3])return downloadPreviewChecklistAttachment(decodeURIComponent(match[1]),decodeURIComponent(match[3]));
      return json({error:"not_found"},404);
    }
    if(url.search)return json({error:"invalid_transaction"},400);
    if(match?.[4]&&method==="POST"){
      const form=init.body instanceof FormData?init.body:input instanceof Request?await input.formData():null;
      if(!form||[...form.keys()].some(k=>!["file","requestId","expectedUpdatedAt","expectedItemUpdatedAt"].includes(k))||[...new Set(form.keys())].some(k=>form.getAll(k).length!==1))return json({error:"invalid_attachment"},400);
      return json(await uploadPreviewChecklistAttachment(decodeURIComponent(match[1]),decodeURIComponent(match[4]),{requestId:form.get("requestId"),expectedUpdatedAt:form.get("expectedUpdatedAt"),expectedItemUpdatedAt:form.get("expectedItemUpdatedAt")},form.get("file")));
    }
    const raw=init.body===undefined&&input instanceof Request?await input.text():init.body;
    if(typeof raw!=="string"||new TextEncoder().encode(raw).length>65536)return json({error:"invalid_transaction"},400);
    let body;try{body=JSON.parse(raw);}catch{return json({error:"invalid_transaction"},400);}
    if(setup&&method==="PATCH")return json(updatePreviewChecklistDefault(body));
    if(path==="/api/vendors"&&method==="POST")return json(createPreviewVendor(body),201);
    if(vendor&&method==="PATCH")return json(updatePreviewVendor(decodeURIComponent(vendor[1]),body));
    if(match){const id=decodeURIComponent(match[1]);if(match[2]==="vendors"&&method==="POST")return json(await mutatePreviewVendorSelection(id,body));if(match[2]==="checklist/requirements"&&method==="PATCH")return json(await setPreviewAttachmentRequirement(id,body));if(match[3]&&method==="DELETE")return json(await removePreviewChecklistAttachment(id,decodeURIComponent(match[3]),body));}
    return json({error:"method_not_allowed"},405);
  }catch(error){return json({error:error.code||"preview_failure"},error.status||500);}
}
