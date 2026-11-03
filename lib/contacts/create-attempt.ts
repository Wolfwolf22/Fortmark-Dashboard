/** Unanswered contact creation keeps its exact submitted identity and receipt key. */
import type { QuickCreateLeadInput } from "../data/adapters/leads";
export interface ContactCreateAttempt {key:string;input:Readonly<QuickCreateLeadInput&{requestId:string}>}
export function contactCreateAttempt(previous:ContactCreateAttempt|null,values:QuickCreateLeadInput,uncertain=false,makeId:()=>string=()=>crypto.randomUUID()):ContactCreateAttempt {if(uncertain&&previous)return previous;const {requestId:_request,...fields}=values,key=JSON.stringify(fields);if(previous?.key===key)return previous;const input=structuredClone({...fields,requestId:makeId()});if(input.birthday)Object.freeze(input.birthday);return {key,input:Object.freeze(input)};}
export function contactCreateUncertain(error:unknown,alreadyUncertain=false):boolean {const status=(error as{status?:number}|null)?.status;return alreadyUncertain||status===undefined||status>=500;}
export function contactCreateAttemptAfterClose(attempt:ContactCreateAttempt|null,uncertain:boolean):ContactCreateAttempt|null {return uncertain?attempt:null;}
