/** In-memory personal definitions backed by the Dashboard's owner-scoped store.
 * No account data is written to localStorage or inferred from legacy browser saves.
 */
export type SavePhase = 'loading'|'ready'|'saving'|'error'|'conflict'|'signed-out';
export interface SaveState {phase:SavePhase;message:string}
export class PersonalStorage implements Storage {
  private data:Record<string,string>={};
  private revision=0;
  private generation=0;
  private savedGeneration=0;
  private busy=false;
  private disposed=false;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private state:SaveState={phase:'loading',message:'Loading your workspace…'};
  private listeners=new Set<()=>void>();
  constructor(readonly accountId:string,private namespace:string,private allowedKeys:readonly string[],private endpoint:string,private transport:typeof fetch=(...args)=>fetch(...args)){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(phase:SavePhase,message:string){this.state={phase,message};this.listeners.forEach(fn=>fn());}
  get dirty(){return this.generation!==this.savedGeneration;}
  get length(){return Object.keys(this.data).length;}
  key(index:number){return Object.keys(this.data)[index]??null;}
  getItem(key:string){return this.data[key]??null;}
  setItem(key:string,value:string){
    if(this.disposed || !['ready','saving'].includes(this.state.phase))throw new Error('Your workspace is not ready to save. Check the save status and retry.');
    if(!this.allowedKeys.includes(key))throw new Error('Unsupported personal setting');
    const next={...this.data,[key]:String(value)};
    if(new TextEncoder().encode(JSON.stringify(next)).length>3_000_000)throw new Error('Your workspace is full. Remove an older saved item first.');
    this.data=next;this.generation++;this.publish('saving','Saving to your account…');
    clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),250);
  }
  removeItem(key:string){if(!(key in this.data))return;this.setItem(key,this.data[key]);delete this.data[key];}
  clear(){for(const key of Object.keys(this.data))this.removeItem(key);}
  async load(){
    try {
      const response=await this.transport(`${this.endpoint}?namespace=${encodeURIComponent(this.namespace)}`,{cache:'no-store',credentials:'same-origin'});
      if(this.disposed)return;
      if(response.status===401||response.status===403){this.invalidate();return;}
      if(!response.ok)throw new Error('Your personal workspace could not be loaded. Retry to continue.');
      const result=await response.json();if(this.disposed)return;
      if(result.userId!==this.accountId){this.invalidate();return;}
      if(!Number.isSafeInteger(result.revision)||result.revision<0||!result.data||typeof result.data!=='object'||Array.isArray(result.data))throw new Error('Unsupported workspace response');
      const entries=Object.entries(result.data);if(entries.some(([key,value])=>!this.allowedKeys.includes(key)||typeof value!=='string'))throw new Error('Unsupported workspace settings');
      this.data=Object.fromEntries(entries) as Record<string,string>;this.revision=result.revision;this.generation=0;this.savedGeneration=0;
      this.publish('ready','Saved to your account');
    }catch(error){if(!this.disposed)this.publish('error',error instanceof Error?error.message:'Workspace unavailable');}
  }
  async flush(){
    if(this.disposed||this.busy||!this.dirty||this.state.phase==='conflict'||this.state.phase==='signed-out')return;
    this.busy=true;this.publish('saving','Saving to your account…');
    try {
      while(this.dirty&&!this.disposed){
        const generation=this.generation;
        const response=await this.transport(this.endpoint,{method:'PUT',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:this.accountId,namespace:this.namespace,revision:this.revision,data:this.data})});
        if(this.disposed)return;
        if(response.status===401||response.status===403){this.invalidate();return;}
        if(response.status===409){this.publish('conflict','Your account or workspace changed in another tab. Reload before saving. Unsaved changes remain in this tab.');return;}
        if(!response.ok)throw new Error('Changes have not reached your account. Keep this tab open and retry.');
        const saved=await response.json();if(this.disposed)return;
        if(saved.userId!==this.accountId){this.invalidate();return;}
        if(saved.revision!==this.revision+1)throw new Error('Save confirmation could not be verified. Reload before saving again.');
        this.revision=saved.revision;this.savedGeneration=generation;
      }
      if(!this.disposed)this.publish('ready','Saved to your account');
    }catch(error){if(!this.disposed)this.publish('error',error instanceof Error?error.message:'Save failed');}
    finally{this.busy=false;}
  }
  invalidate(){this.data={};this.generation=0;this.savedGeneration=0;clearTimeout(this.timer);this.disposed=true;this.publish('signed-out','Your sign-in changed. Return to FortMark to continue.');}
  dispose(){this.disposed=true;clearTimeout(this.timer);this.data={};this.listeners.clear();}
}

let personal:Storage|null=null;
export function activatePersonalStorage(storage:Storage|null){personal=storage;}
export function getPersonalStorage():Storage {
  if(personal)return personal;
  throw new Error('Your personal workspace is loading.');
}
