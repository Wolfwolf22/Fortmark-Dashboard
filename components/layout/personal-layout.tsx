"use client";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@clerk/nextjs';
import { PersonalStorage, activatePersonalStorage } from '@/lib/workspaces/personal-storage';
import { connectLayoutStorage } from '@/lib/stores/layout';
import { setLocalWorkspaceOwner } from '@/lib/workspaces/account-local';
import { useAiStore } from '@/lib/ai/store';
import { useDateRange } from '@/lib/stores/date-range';
import { apiPath } from '@/lib/routes';

export function PersonalLayout({ownerId,clerkUserId,children}:{ownerId:string|null;clerkUserId:string;children:ReactNode}){
  const {userId,isLoaded,isSignedIn}=useAuth();
  const changed=isLoaded&&(!isSignedIn||clerkUserId!==userId);
  const [storage,setStorage]=useState<PersonalStorage|null>(null);
  useEffect(()=>{
    if(!ownerId)return;
    const next=new PersonalStorage(ownerId,'dashboard-layout',['layout','notifications'],apiPath('/api/personal-workspace'));
    setStorage(next);activatePersonalStorage(next);setLocalWorkspaceOwner(null);
    useAiStore.setState({threads:[],activeId:null});setLocalWorkspaceOwner(ownerId);void useAiStore.persist.rehydrate();
    useDateRange.getState().setPreset('month');
    void next.load().then(()=>{if(next.getSnapshot().phase==='ready')connectLayoutStorage(next);});
    const guard=(event:BeforeUnloadEvent)=>{if(next.dirty){event.preventDefault();event.returnValue='';}};
    const resume=(event:PageTransitionEvent)=>{if(event.persisted)location.reload();};
    window.addEventListener('beforeunload',guard);window.addEventListener('pageshow',resume);
    return()=>{window.removeEventListener('beforeunload',guard);window.removeEventListener('pageshow',resume);next.dispose();connectLayoutStorage(null);activatePersonalStorage(null);setLocalWorkspaceOwner(null);useAiStore.setState({threads:[],activeId:null});};
  },[ownerId]);
  useEffect(()=>{if(changed){storage?.invalidate();connectLayoutStorage(null);setLocalWorkspaceOwner(null);useAiStore.setState({threads:[],activeId:null});}},[changed,storage]);
  if(changed)return <div className="p-8"><p>Your sign-in changed.</p><a href="https://app.fortmark.net/dashboard" className="underline">Reload your Dashboard</a></div>;
  if(!isLoaded)return <p className="p-8" role="status">Verifying your FortMark account...</p>;
  if(!ownerId)return <div className="p-8">Your personal workspace is not available yet. Please reload Dashboard to finish setting up your account.</div>;
  return storage?<LayoutStatus storage={storage}>{children}</LayoutStatus>:<p className="p-8" role="status">Loading your workspace…</p>;
}
function LayoutStatus({storage,children}:{storage:PersonalStorage;children:ReactNode}){
  const state=useSyncExternalStore(storage.subscribe,storage.getSnapshot,storage.getSnapshot);
  const retry=async()=>{if(storage.dirty)await storage.flush();else{await storage.load();if(storage.getSnapshot().phase==='ready')connectLayoutStorage(storage);}};
  if(state.phase==='loading'||state.phase==='signed-out'||(state.phase==='error'&&!storage.dirty))return <div className="space-y-4 p-8"><p role="status">{state.message}</p><button onClick={()=>void retry()} className="underline">Retry workspace</button><a href="https://app.fortmark.net/dashboard" className="block underline">Return to Dashboard</a></div>;
  return <>{state.phase!=='ready'&&<div role={state.phase==='saving'?'status':'alert'} className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-6 py-2 text-xs"><span>{state.message}</span>{state.phase==='error'?<button className="underline" onClick={()=>void retry()}>Retry save</button>:state.phase==='conflict'?<button className="underline" onClick={()=>location.reload()}>Reload</button>:null}</div>}{children}</>;
}
