/** Scoped vendor engagement records. File contents travel only through authorized app routes. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getTransactionSource, TransactionsError } from "./transactions";
import type { VendorRole } from "../../transactions/vendor-domain";
import type { TransactionVendorDetail, TransactionVendorDetailPatchInput, TransactionVendorDetailUploadInput, TransactionVendorDetailRemoveInput, TransactionVendorDetailSummary, TransactionVendorDetailHistory, VendorAttachmentKind } from "../../transactions/vendor-detail-domain";
export type VendorDetailUpdateInput=TransactionVendorDetailPatchInput;
export type VendorFileKind=VendorAttachmentKind;
export type VendorFileUploadInput=TransactionVendorDetailUploadInput;
export type VendorFileRemoveInput=TransactionVendorDetailRemoveInput;
export type VendorDetailSummary=TransactionVendorDetailSummary;
export type VendorDetailHistory=TransactionVendorDetailHistory;
async function requireSource(){if(await getTransactionSource()!=="db")throw new TransactionsError("sample_read_only",403);}
async function request<T>(path:string,init?:RequestInit,binary=false):Promise<T>{
 const send=()=>fetch(apiPath(path),{...init,headers:{Accept:binary?"application/pdf, image/jpeg, image/png":"application/json",...(init?.body&&!(init.body instanceof FormData)?{"Content-Type":"application/json"}:{})}});
 let response:Response;if(!init?.method){let first:Response|null=null;try{first=await send();}catch{/* One safe read retry. */}response=!first||first.status===502||first.status===504?await send():first;}else response=await send();
 if(!response.ok){let code="unknown";try{const body=await response.json();if(typeof body.error==="string")code=body.error;}catch{/* HTTP status remains authoritative. */}throw new TransactionsError(code,response.status);}return (binary?response.blob():response.json()) as Promise<T>;
}
const detailPath=(transactionId:string,detailId:string)=>`/api/transactions/${encodeURIComponent(transactionId)}/vendor-details/${encodeURIComponent(detailId)}`;
export async function getTransactionVendorDetail(transactionId:string,detailId:string):Promise<TransactionVendorDetail>{await requireSource();return request(detailPath(transactionId,detailId));}
export async function getTransactionVendorDetails(transactionId:string,role?:VendorRole):Promise<VendorDetailHistory>{await requireSource();return request(`/api/transactions/${encodeURIComponent(transactionId)}/vendor-details${role?`?${new URLSearchParams({role})}`:""}`);}
export async function updateTransactionVendorDetail(transactionId:string,detailId:string,input:VendorDetailUpdateInput):Promise<TransactionVendorDetail>{await requireSource();try{return await request(detailPath(transactionId,detailId),{method:"PATCH",body:JSON.stringify(input)});}finally{bumpDataVersion();}}
export async function uploadTransactionVendorFile(transactionId:string,detailId:string,input:VendorFileUploadInput,file:File):Promise<TransactionVendorDetail>{await requireSource();const form=new FormData();form.append("file",file,file.name);form.append("requestId",input.requestId);form.append("expectedUpdatedAt",input.expectedUpdatedAt);form.append("expectedDetailUpdatedAt",input.expectedDetailUpdatedAt);form.append("kind",input.kind);try{return await request(`${detailPath(transactionId,detailId)}/attachments`,{method:"POST",body:form});}finally{bumpDataVersion();}}
export async function removeTransactionVendorFile(transactionId:string,attachmentId:string,input:VendorFileRemoveInput):Promise<TransactionVendorDetail>{await requireSource();try{return await request(`/api/transactions/${encodeURIComponent(transactionId)}/vendor-attachments/${encodeURIComponent(attachmentId)}`,{method:"DELETE",body:JSON.stringify(input)});}finally{bumpDataVersion();}}
export async function downloadTransactionVendorFile(transactionId:string,attachmentId:string):Promise<Blob>{await requireSource();return request(`/api/transactions/${encodeURIComponent(transactionId)}/vendor-attachments/${encodeURIComponent(attachmentId)}`,undefined,true);}
