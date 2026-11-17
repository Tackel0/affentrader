import type {ExecutableQuote} from "./quotes";
export interface PaperObservation {symbol:string;price:number;time:number;simulated?:boolean;quote?:ExecutableQuote}
interface PumpDeps {valid:()=>boolean;write:(observations:readonly PaperObservation[],valid:()=>boolean)=>Promise<unknown>;failed:(error:unknown)=>void}
/** Preserve every delivered transition while amortizing durable writes over bounded FIFO batches. */
export class PaperPricePump {
  private queue:PaperObservation[]=[];private running=false;private stopped=false;
  constructor(private deps:PumpDeps,private capacity=32768,private batchSize=256){}
  push(observation:PaperObservation){
    if(this.stopped||!this.deps.valid())return;
    if(!(observation.price>0)||!Number.isFinite(observation.price)||!Number.isFinite(observation.time))return;
    if(this.queue.length>=this.capacity){this.stop();this.deps.failed(new Error("Paper matching queue is full. Execution stopped before dropping observations silently."));return;}
    this.queue.push(observation);void this.drain();
  }
  private async drain(){
    if(this.running)return;this.running=true;
    try{while(this.queue.length&&!this.stopped&&this.deps.valid()){
      const batch=this.queue.splice(0,this.batchSize);await this.deps.write(batch,()=>!this.stopped&&this.deps.valid());
    }}catch(error){this.stop();this.deps.failed(error);}finally{this.running=false;if(!this.deps.valid())this.queue=[];}
  }
  stop(){this.stopped=true;this.queue=[];}
}
