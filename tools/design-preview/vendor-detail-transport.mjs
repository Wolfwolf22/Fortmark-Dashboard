import { VENDOR_ROLES } from "../../lib/transactions/vendor-domain.ts";
import { getPreviewVendorDetail,listPreviewVendorDetails,updatePreviewVendorDetail,uploadPreviewVendorFile,removePreviewVendorFile,downloadPreviewVendorFile } from "./vendor-detail-model.mjs";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"private, no-store"}});
export async function vendorDetailTransport(path,url,input,init={}){
 const detail=/^\/api\/transactions\/([^/]+)\/vendor-details(?:\/([^/]+)(?:\/(attachments))?)?$/.exec(path),file=/^\/api\/transactions\/([^/]+)\/vendor-attachments\/([^/]+)$/.exec(path);
 if(!detail&&!file)return undefined;
 const method=(init.method||(typeof input==="object"&&input.method)||"GET").toUpperCase(),id=decodeURIComponent((detail||file)[1]);
 try{
  if(method==="GET"){
   if(detail&&!detail[2]){const role=url.searchParams.get("role");if([...url.searchParams.keys()].some(k=>k!=="role")||url.searchParams.getAll("role").length>1||role&&!VENDOR_ROLES.includes(role))return json({error:"invalid_vendor_details"},400);return json(listPreviewVendorDetails(id,role));}
   if(url.search)return json({error:"invalid_vendor_details"},400);
   if(file)return downloadPreviewVendorFile(id,decodeURIComponent(file[2]));
   if(detail?.[2]&&!detail[3])return json(getPreviewVendorDetail(id,decodeURIComponent(detail[2])));
   return json({error:"not_found"},404);
  }
  if(url.search)return json({error:"invalid_vendor_details"},400);
  if(detail?.[3]&&method==="POST"){
   const form=init.body instanceof FormData?init.body:input instanceof Request?await input.formData():null;
   if(!form||[...form.keys()].some(k=>!["file","requestId","expectedUpdatedAt","expectedDetailUpdatedAt","kind"].includes(k))||[...new Set(form.keys())].some(k=>form.getAll(k).length!==1))return json({error:"invalid_attachment"},400);
   return json(await uploadPreviewVendorFile(id,decodeURIComponent(detail[2]),{requestId:form.get("requestId"),expectedUpdatedAt:form.get("expectedUpdatedAt"),expectedDetailUpdatedAt:form.get("expectedDetailUpdatedAt"),kind:form.get("kind")},form.get("file")));
  }
  const raw=init.body===undefined&&input instanceof Request?await input.text():init.body;if(typeof raw!=="string"||new TextEncoder().encode(raw).length>65536)return json({error:"invalid_vendor_details"},400);let body;try{body=JSON.parse(raw);}catch{return json({error:"invalid_vendor_details"},400);}
  if(detail?.[2]&&!detail[3]&&method==="PATCH")return json(await updatePreviewVendorDetail(id,decodeURIComponent(detail[2]),body));
  if(file&&method==="DELETE")return json(await removePreviewVendorFile(id,decodeURIComponent(file[2]),body));
  return json({error:"method_not_allowed"},405);
 }catch(error){return json({error:error.code||"preview_failure"},error.status||500);}
}
