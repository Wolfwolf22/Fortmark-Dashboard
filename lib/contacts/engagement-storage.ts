import "server-only";
import { put,get,del,type PutCommandOptions,type GetCommandOptions,type DeleteCommandOptions } from "@vercel/blob";
import { transactionFilesEnabled,type TransactionFileStorage } from "../transactions/transaction-file-storage.ts";
type Sdk={put:(path:string,bytes:Buffer,options:PutCommandOptions)=>Promise<{pathname:string}>;get:(path:string,options:GetCommandOptions)=>ReturnType<typeof get>;del:(path:string,options:DeleteCommandOptions)=>Promise<void>};
export const isContactEngagementPath=(path:string)=>/^contact-engagements\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(path);
/** Same dedicated private store; a separate namespace never broadens transaction-file authorization. */
export function createContactEngagementStorage(env:Record<string,string|undefined>=process.env,options:{sdk?:Sdk;signal?:AbortSignal}={}):TransactionFileStorage{
 const token=env.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN?.trim(),enabled=transactionFilesEnabled(env),sdk=options.sdk??{put,get,del},signal=()=>options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000);
 return{enabled,
  async put(path,bytes,type){if(!enabled)return{ok:false,reason:"not_configured"};if(!isContactEngagementPath(path)||type!=="application/pdf"||bytes.length<1||bytes.length>4194304)return{ok:false,reason:"unavailable"};try{const result=await sdk.put(path,Buffer.from(bytes),{token,access:"private",contentType:"application/pdf",addRandomSuffix:false,allowOverwrite:false,maximumSizeInBytes:4194304,cacheControlMaxAge:60,abortSignal:signal()});return result.pathname===path?{ok:true}:{ok:false,reason:"unavailable"};}catch{return{ok:false,reason:"unavailable"};}},
  async get(path){if(!token)return{ok:false,reason:"not_configured"};if(!isContactEngagementPath(path))return{ok:false,reason:"not_found"};try{const result=await sdk.get(path,{token,access:"private",useCache:false,abortSignal:signal()});if(!result)return{ok:false,reason:"not_found"};if(result.statusCode!==200)return{ok:false,reason:"unavailable"};if(result.blob.pathname!==path||result.blob.size<1||result.blob.size>4194304){await result.stream.cancel();return{ok:false,reason:"unavailable"};}return{ok:true,stream:result.stream,sizeBytes:result.blob.size};}catch{return{ok:false,reason:"unavailable"};}},
  async removeOrphan(path){if(!token||!isContactEngagementPath(path))return false;try{await sdk.del(path,{token,abortSignal:signal()});return true;}catch{return false;}}
 };
}
