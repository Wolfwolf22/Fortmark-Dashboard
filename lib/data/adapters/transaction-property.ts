/** Scoped MLS reads and reviewed property links; CRM text never enters query URLs. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getTransactionSource,TransactionsError } from "./transactions";
import type { TransactionPropertyView,TransactionPropertyLookup,TransactionPropertyMutation } from "../../transactions/property-domain";
import type { TransactionWorkspace } from "../../transactions/workspace-domain";
async function source(){if(await getTransactionSource()!=="db")throw new TransactionsError("sample_read_only",403);}
async function request<T>(path:string,init?:RequestInit):Promise<T>{const send=()=>fetch(apiPath(path),{...init,headers:{Accept:"application/json",...(init?.body?{"Content-Type":"application/json"}:{})}});let response:Response;if(!init?.method){let first:Response|null=null;try{first=await send();}catch{/* One safe read retry. */}response=!first||first.status===502||first.status===504?await send():first;}else response=await send();if(!response.ok){let code="unknown";try{const body=await response.json();if(typeof body.error==="string")code=body.error;}catch{/* Keep HTTP status. */}throw new TransactionsError(code,response.status);}return response.json() as Promise<T>;}
const path=(id:string)=>`/api/transactions/${encodeURIComponent(id)}/property`;
export async function getTransactionProperty(id:string):Promise<TransactionPropertyView>{await source();return request(path(id));}
export async function lookupTransactionProperty(id:string,input:{mlsNumber:string}):Promise<TransactionPropertyLookup>{await source();return request(`${path(id)}/lookup`,{method:"POST",body:JSON.stringify(input)});}
export async function updateTransactionProperty(id:string,input:TransactionPropertyMutation):Promise<TransactionWorkspace>{await source();try{return await request(path(id),{method:"PATCH",body:JSON.stringify(input)});}finally{bumpDataVersion();}}
