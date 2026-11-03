"use client";
import { useMemo, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, GripVertical, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { GcTransactionList } from "./gc-workspace";
import { TransactionStageReview } from "./stage-control";
import { type Transaction,type TransactionStage,TRANSACTION_STAGES,TRANSACTION_STAGE_LABELS } from "@/lib/data/types";
import { canTransition,isTerminalStage } from "@/lib/transactions/stages";
import { formatTransactionDay, transactionDay } from "@/lib/transactions/calendar-days";
import { bumpDataVersion } from "@/lib/data/store";
import { cn,formatCurrencyCompact } from "@/lib/utils";
import { closeCountdown,SIDE_SHORT } from "./txn-shared";
import { dueDescription, transactionCanEdit } from "./workspace-state";
export function TransactionBoardCard({txn,onOpen,handle}:{txn:Transaction;onOpen:(id:string)=>void;handle?:React.ReactNode}){
 if(txn.side==="gc")return <GcTransactionList transactions={[txn]} onOpen={onOpen}/>;
 const next=[...txn.milestones].filter(item=>item.state!=="done").sort((a,b)=>a.date.localeCompare(b.date))[0];
 return <div className="min-w-0 rounded-panel border border-border bg-card p-4 shadow-card"><div className="mb-2 flex items-center justify-between gap-2"><Badge variant="muted">{SIDE_SHORT[txn.side]}</Badge>{handle}</div><button type="button" className="min-h-11 w-full break-words text-left text-[14px] font-semibold leading-snug hover:underline" onClick={()=>onOpen(txn.id)}>{txn.address}</button><p className="mt-1 break-words text-xs text-muted-foreground">{txn.city}</p>{txn.mlsNumber&&<p className="mt-2 break-words text-[11px] text-muted-foreground">MLS {txn.mlsNumber}{txn.listingDataset?" · Linked":""}</p>}<p className="mt-2 break-words text-xs text-muted-foreground">{txn.clientName}</p><div className="my-3 border-t border-border pt-3"><p className="text-[11px] text-muted-foreground">Next deadline</p><p className="mt-1 break-words text-xs font-semibold">{next?.label??"No outstanding deadline"}</p>{next&&<p className="mt-1 text-xs text-muted-foreground tabular">{formatTransactionDay(next.date,true)} · {dueDescription(transactionDay(next.date)??next.date)}</p>}</div><p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular"><CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden/>{closeCountdown(txn)}</p><p className="mt-2 text-xs text-muted-foreground tabular">{txn.contractPrice>0?formatCurrencyCompact(txn.contractPrice):"Price not recorded"} {txn.contractPrice>0?"contract":""}</p></div>;
}
function DraggableCard({txn,onOpen,canWrite,disabled}:{txn:Transaction;onOpen:(id:string)=>void;canWrite:boolean;disabled:boolean}){
 const editable=transactionCanEdit(txn,canWrite)&&!disabled,{attributes,listeners,setNodeRef,setActivatorNodeRef,isDragging}=useDraggable({id:txn.id,disabled:!editable});
 return <div ref={setNodeRef} className={cn(isDragging&&"opacity-40")}><TransactionBoardCard txn={txn} onOpen={onOpen} handle={editable?<Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon" className="h-10 w-10 cursor-grab touch-none active:cursor-grabbing" {...attributes} {...listeners} aria-label={`Move ${txn.address} to another stage`}><GripVertical aria-hidden className="h-4 w-4"/></Button>:undefined}/></div>;
}
function Column({stage,items,onOpen,canWrite,active,disabled}:{stage:TransactionStage;items:Transaction[];onOpen:(id:string)=>void;canWrite:boolean;active:Transaction|undefined;disabled:boolean}){
 const allowed=Boolean(active&&canTransition(active.stage,stage)),{setNodeRef,isOver}=useDroppable({id:stage,disabled:!allowed});
 return <section aria-label={`${TRANSACTION_STAGE_LABELS[stage]} column`} className="flex w-[264px] shrink-0 flex-col gap-3 sm:w-[280px]"><div className="flex items-center justify-between gap-2 px-1"><h3 className="text-xs font-semibold">{TRANSACTION_STAGE_LABELS[stage]}</h3><span className="text-xs text-muted-foreground tabular">{items.length}</span></div><div ref={setNodeRef} className={cn("flex min-h-[180px] flex-1 flex-col gap-3 rounded-card border border-border bg-tint p-2",isOver&&allowed&&"ring-1 ring-ring",active&&!allowed&&"opacity-60")}>{items.map(txn=><DraggableCard key={txn.id} txn={txn} onOpen={onOpen} canWrite={canWrite} disabled={disabled}/>)}{!items.length&&<p className="py-8 text-center text-xs text-muted-foreground">No files</p>}</div></section>;
}
export function KanbanBoard({transactions,loading,onOpen,canWrite=false}:{transactions:Transaction[]|undefined;loading:boolean;onOpen:(id:string)=>void;canWrite?:boolean}){
 const [activeId,setActiveId]=useState<string|null>(null),[proposal,setProposal]=useState<{opening:Transaction;target:TransactionStage}|null>(null),[notice,setNotice]=useState<string|null>(null);
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(KeyboardSensor));
 const byStage=useMemo(()=>Object.fromEntries(TRANSACTION_STAGES.map(stage=>[stage,(transactions??[]).filter(item=>item.side!=="gc"&&item.stage===stage)])) as Record<TransactionStage,Transaction[]>,[transactions]);
 const active=transactions?.find(item=>item.id===activeId);
 function drop(event:DragEndEvent){setActiveId(null);const txn=transactions?.find(item=>item.id===event.active.id),target=event.over?.id as TransactionStage|undefined;if(!txn||!target||target===txn.stage)return;if(!transactionCanEdit(txn,canWrite)||!canTransition(txn.stage,target)){setNotice("That move is not available from the current stage. Open the file to review available stages.");return;}setProposal({opening:txn,target});}
 if(!transactions)return <div className="flex max-w-full gap-4 overflow-hidden">{[1,2,3].map(n=><Skeleton key={n} className="h-72 w-[264px] shrink-0 rounded-card"/>)}</div>;
 if(!transactions.length)return <EmptyState icon={Inbox} title="No transactions match" description="Adjust the worklist filters or search to find a file."/>;
 return <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={event=>{setActiveId(String(event.active.id));setNotice(null);}} onDragCancel={()=>setActiveId(null)} onDragEnd={drop}>{notice&&<p role="status" className="mb-3 text-sm">{notice}</p>}<div aria-busy={loading} className="flex w-full min-w-0 max-w-full items-stretch gap-4 overflow-x-auto pb-4">{TRANSACTION_STAGES.map(stage=><Column key={stage} stage={stage} items={byStage[stage]} onOpen={onOpen} canWrite={canWrite} active={active} disabled={Boolean(proposal)}/>)}</div><DragOverlay dropAnimation={null}>{active?<div className="w-[248px] shadow-pop"><TransactionBoardCard txn={active} onOpen={()=>undefined}/></div>:null}</DragOverlay>{proposal&&<TransactionStageReview opening={proposal.opening} current={transactions.find(item=>item.id===proposal.opening.id)??proposal.opening} target={proposal.target} canEdit={canWrite&&!isTerminalStage(proposal.opening.stage)} onClose={()=>setProposal(null)} onRefresh={bumpDataVersion}/>}</DndContext>;
}
