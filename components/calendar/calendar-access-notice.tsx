"use client";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { personalFailure } from "./personal-state";
export function CalendarAccessNotice({open,error,busy,onRetry,onClose}:{open:boolean;error:unknown;busy:boolean;onRetry:()=>void;onClose:()=>void}){return <Dialog open={open} onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent><DialogHeader><DialogTitle>Calendar record unavailable</DialogTitle><DialogDescription>{personalFailure(error)}</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground">Private details are hidden until access can be verified again.</p><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close</Button><Button type="button" disabled={busy} onClick={onRetry}>{busy?"Checking access…":"Retry authorized access"}</Button></DialogFooter></DialogContent></Dialog>;}
