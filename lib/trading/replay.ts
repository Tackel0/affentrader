import {processBar,type Account,type Bar} from "./broker";
import type {PaperExecutionSource} from "./executionSource";
/** Same-bar updates visit newly observed movement, never extrema from before order placement. */
export function processReplayUpdate(account:Account,symbol:string,before:Bar|undefined,bar:Bar,source:PaperExecutionSource="replay"){
  if(before&&bar.time<before.time)return {account,fills:[]};
  if(before&&bar.time===before.time){
    if(bar.close===before.close&&bar.high===before.high&&bar.low===before.low)return {account,fills:[]};
    const high=Math.max(before.close,bar.close,bar.high>before.high?bar.high:-Infinity);
    const low=Math.min(before.close,bar.close,bar.low<before.low?bar.low:Infinity);
    return processBar(account,symbol,{time:bar.time,open:before.close,high,low,close:bar.close},source);
  }
  return processBar(account,symbol,bar,source);
}
