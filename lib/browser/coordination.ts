export type ExecutionStatus="standby"|"primary"|"unavailable";
export interface ExecutionSnapshot {status:ExecutionStatus;epoch:number;phase?:"idle"|"waiting"|"preparing"|"running"|"failed";error?:string}
export interface BrowserLocks {request<T>(name:string,options:{signal?:AbortSignal},callback:()=>Promise<T>):Promise<T>}
export const nativeBrowserLocks=():BrowserLocks|undefined=>typeof navigator!=="undefined"&&navigator.locks?{request:async(name,options,callback)=>await navigator.locks.request(name,options,callback)}:undefined;

/** A live browser-managed lock is never stolen or replaced by an expiring timer lease. */
export class ExecutionLease {
  private state:ExecutionSnapshot={status:"standby",epoch:0,phase:"idle"};
  private listeners=new Set<()=>void>();
  private controller?:AbortController;
  private release?:()=>void;
  constructor(private locks:BrowserLocks|undefined,private prepare:()=>Promise<void>,private name:string,private unsupported:string){}
  snapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  owns=(epoch:number)=>this.state.status==="primary"&&this.state.epoch===epoch;
  private publish(state:ExecutionSnapshot){this.state=state;for(const listener of this.listeners)listener();}
  start(){
    if(this.controller)return;
    if(!this.locks){this.publish({...this.state,status:"unavailable",phase:"failed",error:this.unsupported});return;}
    const controller=new AbortController();this.controller=controller;this.publish({...this.state,status:"standby",phase:"waiting",error:undefined});
    void this.locks.request(this.name,{signal:controller.signal},async()=>{
      if(controller.signal.aborted||this.controller!==controller)return;this.publish({...this.state,phase:"preparing"});await this.prepare();if(controller.signal.aborted)return;
      await new Promise<void>(resolve=>{this.release=resolve;this.publish({status:"primary",phase:"running",epoch:this.state.epoch+1});});
    }).catch(error=>{if(!controller.signal.aborted&&this.controller===controller)this.publish({...this.state,status:"unavailable",phase:"failed",error:error instanceof Error?error.message:String(error)});});
  }
  stop(){
    const controller=this.controller;this.controller=undefined;if(!controller)return;
    controller.abort();this.publish({...this.state,status:"standby",phase:"idle",error:undefined});const release=this.release;this.release=undefined;release?.();
  }
  fail(error:unknown){this.stop();this.publish({...this.state,status:"unavailable",phase:"failed",error:error instanceof Error?error.message:String(error)});}
}

export class ExclusiveWriteQueue<S>{
  constructor(private locks:BrowserLocks|undefined,private refresh:()=>Promise<void>,private current:()=>S,private name:string,private unsupported:string){}
  async run<T>(action:(state:S)=>T,valid:()=>boolean=()=>true):Promise<T|undefined>{
    if(!this.locks)throw new Error(this.unsupported);
    return this.locks.request(this.name,{},async()=>{if(!valid())return;await this.refresh();if(!valid())return;return action(this.current());});
  }
}
