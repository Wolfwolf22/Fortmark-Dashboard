/** Actual source editors and selected-day rendering with synthetic scoped data; no browser account or network. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),temp=mkdtempSync(join(tmpdir(),"fortmark-calendar-inline-"));
try {
 const entry=`import assert from "node:assert/strict";import React from "react";import {renderToStaticMarkup as render} from "react-dom/server";
 import {MonthDayDialog} from "./components/calendar/month-day-dialog";import {CalendarContactAction} from "./components/calendar/contact-action-editor";import {CalendarReminderEditor} from "./components/calendar/reminder-editor";import {CalendarTransactionEditor} from "./components/calendar/transaction-editor";
 let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;};globalThis.fetch=()=>{throw Error("Unexpected network")};globalThis.__inlineLoads=[];
 const day="2027-03-14",stamp="2027-03-01T15:00:00.000Z",contact="11111111-1111-4111-8111-111111111111";
 const items=Array.from({length:36},(_,i)=>({id:"personal:"+i,kind:"personal",title:"Selected day item "+i,subtitle:"Private",day,allDay:true,startsAt:null,endsAt:null,status:"scheduled",sourceId:String(i),sourceHref:"/calendar",sourceLabel:"My item",blocksTime:false,reschedule:null}));
 const page={items,sources:[{kind:"personal",status:"available",total:36,truncated:false}],fromDay:day,toDay:"2027-03-15",timeZone:"America/New_York",generatedAt:stamp};globalThis.__inlineData=page;
 let html=render(<MonthDayDialog day={day} kinds={["personal"]} onClose={()=>{}} onItemClick={()=>{}}/>);for(let i=0;i<36;i++)check(html.includes("Selected day item "+i),"Every selected-day item remains reachable, including "+i);check(html.includes("Back to month"),"Day detail stays within month workflow");await globalThis.__inlineLoads[0]();check(JSON.stringify(globalThis.__inlineQuery)===JSON.stringify({fromDay:day,toDay:"2027-03-15",kinds:["personal"]}),"Selected day gets a separate bounded request across the DST day");
 globalThis.__inlineData={id:contact,stage:"representation",recordSource:"db",updatedAt:stamp,nextAction:{id:contact,kind:"call",purpose:"Call about the offer",dueAt:"2027-03-14T15:00:00.000Z",assigneeId:contact,assigneeName:"Current agent"}};
 html=render(<CalendarContactAction contactId={contact} canWrite onSaved={()=>{}} onBusyChange={()=>{}}/>);check(html.includes("Call about the offer"),"Calendar uses actual saved action contents");check(!html.includes("Choose a person"),"Inline action never presents another person's assignment selector");
 globalThis.__inlineData={id:contact,stage:"lead",updatedAt:stamp,nextFollowUpDate:"2027-03-14T12:00:00.000Z"};html=render(<CalendarReminderEditor contactId={contact} canWrite={false} onSaved={()=>{}} onBusyChange={()=>{}}/>);check(html.includes("Save reminder")&&html.includes("Mark complete"),"Reminder has direct source actions");check((html.match(/disabled/g)||[]).length>=3,"Read-only Calendar cannot enable reminder writes");
 const deadline={id:contact,kind:"inspection",label:"Current inspection date",dueDate:"2027-03-15",note:"Current saved note",updatedAt:stamp,completedAt:null};globalThis.__inlineData={transaction:{id:contact},updatedAt:stamp,canEdit:true,deadlines:[deadline]};
 const calendarDeadline={id:"deadline:"+contact,kind:"transaction_deadline",title:"Private inspection title",sourceId:contact,reschedule:{kind:"transaction_deadline",sourceId:contact,expectedUpdatedAt:stamp,deadlineId:contact,expectedDeadlineUpdatedAt:stamp}};
 const deadlineEditor=(canWrite)=>render(<CalendarTransactionEditor item={calendarDeadline} canWrite={canWrite} onClose={()=>{}} onSaved={()=>{}}/>);
 html=deadlineEditor(true);check(html.includes("Save deadline")&&html.includes("Current inspection date"),"Actual deadline editor opens current source fields inside Calendar");
 html=deadlineEditor(false);check(/<fieldset[^>]*disabled/.test(html)&&/<button[^>]*disabled[^>]*>Save deadline</.test(html),"Calendar write permission masks a cached writable transaction for a read-only actor");
 globalThis.__inlineData={...globalThis.__inlineData,canEdit:false};html=deadlineEditor(true);check(/<fieldset[^>]*disabled/.test(html)&&/<button[^>]*disabled[^>]*>Save deadline</.test(html),"Calendar permission never overrides a terminal or read-only file");
 globalThis.__inlineData={...globalThis.__inlineData,transaction:{id:"another-file"}};html=deadlineEditor(true);check(html.includes("Loading the current transaction record")&&!html.includes("Current inspection date")&&!html.includes("Save deadline"),"Switching source files quarantines retained prior-workspace fields");
 globalThis.__inlineError={status:403};html=deadlineEditor(true);check(html.includes("Transaction unavailable")&&!html.includes("Private inspection title")&&!html.includes("Current inspection date"),"A refused source read hides cached Calendar and transaction identities");globalThis.__inlineError=null;
 console.log(checks+"/"+checks+" Calendar inline view checks passed");`;
 const dialog=`import React from "react";export const Dialog=({children,open=true})=>open?<div>{children}</div>:null;export const DialogContent=({children,focusFallback,...p})=><section {...p}>{children}</section>;export const DialogHeader=({children})=><header>{children}</header>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;export const DialogFooter=({children})=><footer>{children}</footer>;`;
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:"tsx"},bundle:true,platform:"node",format:"esm",jsx:"automatic",write:false,packages:"external",plugins:[{name:"inline-scoped-context",setup(b){
 b.onLoad({filter:/lib\/data\/hooks\.ts$/},()=>({contents:'export function useQuery(load){globalThis.__inlineLoads.push(load);return {data:globalThis.__inlineData,loading:false,error:globalThis.__inlineError??null,refetch(){}}}',loader:"ts"}));
 b.onLoad({filter:/lib\/data\/adapters\/internal-calendar\.ts$/},()=>({contents:'export async function getInternalCalendar(q){globalThis.__inlineQuery=q;return globalThis.__inlineData}',loader:"ts"}));
 b.onLoad({filter:/components\/ui\/dialog\.tsx$/},()=>({contents:dialog,loader:"tsx"}));
 b.onLoad({filter:/components\/layout\/session-user\.tsx$/},()=>({contents:'export const useSessionUser=()=>({id:"11111111-1111-4111-8111-111111111111",role:"Agent"});',loader:"ts"}));
 }}]});
 // Resolve installed packages from the repository without copying or changing node_modules.
 const path=join(root,".calendar-inline-test.mjs");writeFileSync(path,out.outputFiles[0].contents);try{const r=spawnSync(process.execPath,[path],{stdio:"inherit"});if(r.error)throw r.error;if(r.status!==0)throw Error("Calendar inline checks failed");}finally{rmSync(path,{force:true});}
} finally {rmSync(temp,{recursive:true,force:true});}
