export type PaperExecutionSource="market"|"simulation"|"replay"|"replay_simulation";
export const paperSampleSource=(simulated?:boolean):PaperExecutionSource|undefined=>typeof simulated==="boolean"?simulated?"simulation":"market":undefined;
export const validPaperSource=(value:unknown):value is PaperExecutionSource|undefined=>value===undefined||value==="market"||value==="simulation"||value==="replay"||value==="replay_simulation";
export const paperSourceLabel=(source:PaperExecutionSource|undefined)=>source==="market"?"Market feed":source==="simulation"?"Offline simulation":source==="replay"?"Replay":source==="replay_simulation"?"Replay · synthetic":"Not recorded";
