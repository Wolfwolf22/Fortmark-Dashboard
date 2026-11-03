"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { getTransactionProperty } from "@/lib/data/adapters/transaction-property";
import type { TransactionPropertyView } from "@/lib/transactions/property-domain";
/** Keep provider reads on the visible file only. Focus/return and five minutes refresh live MLS fields. */
export function watchTransactionProperty(refresh:()=>void,doc:Pick<Document,"visibilityState"|"addEventListener"|"removeEventListener">,target:Pick<Window,"addEventListener"|"removeEventListener"|"setInterval"|"clearInterval">){const visible=()=>{if(doc.visibilityState==="visible")refresh();};target.addEventListener("focus",visible);doc.addEventListener("visibilitychange",visible);const timer=target.setInterval(visible,300000);visible();return()=>{target.removeEventListener("focus",visible);doc.removeEventListener("visibilitychange",visible);target.clearInterval(timer);};}
export function transactionPropertyReadCurrent(requestKey:string,currentKey:string,request:number,latest:number,mounted:boolean):boolean{return mounted&&requestKey===currentKey&&request===latest;}
export function useTransactionProperty(transactionId:string,referenceKey:string){
 const key=`${transactionId}:${referenceKey}`,scope=useRef(key),mounted=useRef(false),running=useRef<string|null>(null),serial=useRef(0);scope.current=key;
 const [answer,setAnswer]=useState<{key:string;view:TransactionPropertyView}|null>(null),[loading,setLoading]=useState(true),[failure,setFailure]=useState<{key:string;error:Error}|null>(null);
 const refresh=useCallback(()=>{if(typeof document!=="undefined"&&document.visibilityState!=="visible"||running.current===key)return;running.current=key;const request=++serial.current;setLoading(true);void getTransactionProperty(transactionId).then(view=>{if(transactionPropertyReadCurrent(key,scope.current,request,serial.current,mounted.current)){if(view.transactionId!==transactionId)throw new Error("Property response mismatch");setAnswer({key,view});setFailure(null);}}).catch(error=>{if(transactionPropertyReadCurrent(key,scope.current,request,serial.current,mounted.current))setFailure({key,error:error instanceof Error?error:new Error(String(error))});}).finally(()=>{if(running.current===key&&serial.current===request)running.current=null;if(transactionPropertyReadCurrent(key,scope.current,request,serial.current,mounted.current))setLoading(false);});},[transactionId,key]);
 useEffect(()=>{mounted.current=true;const stop=watchTransactionProperty(refresh,document,window);return()=>{mounted.current=false;stop();};},[refresh]);
 return {view:answer?.key===key?answer.view:undefined,loading,error:failure?.key===key?failure.error:null,refresh};
}
