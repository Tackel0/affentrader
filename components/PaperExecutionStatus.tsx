"use client";
import {useState} from "react";
import {usePaperRole} from "@/hooks/usePaperOwnership";
import {paperExecutionOwner} from "@/lib/trading/paperOwnership";
import {inspectPaperLocks,type PaperLockCounts} from "@/lib/trading/lockInspection";
import {isPopout} from "@/lib/windowScope";
export function PaperExecutionStatus({replay}:{replay:boolean}){
  const role=usePaperRole(),[inspection,setInspection]=useState<PaperLockCounts|string>(),[busy,setBusy]=useState(false);
  const inspect=async()=>{setBusy(true);try{setInspection(await inspectPaperLocks());}catch(error){setInspection(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const message=role.status==="primary"?"Live paper matching active in this tab":role.status==="unavailable"?role.error:role.phase==="preparing"?"Preparing the shared paper account":role.phase==="idle"?(isPopout()?"Paper matching belongs to a main window":"Paper matching is not started in this tab"):"Waiting for exclusive paper matching access";
  return <div className="paper-execution-status">
    <p role="status" data-testid="paper-execution-owner">{message}{replay?" · Replay account belongs to this tab only":""}</p>
    <button type="button" className="link-button" disabled={busy} onClick={()=>void inspect()}>Matching details</button>
    {inspection!==undefined?<button type="button" className="link-button" onClick={()=>setInspection(undefined)}>Hide matching details</button>:null}
    {role.status==="unavailable"||role.phase==="idle"&&!isPopout()?<button type="button" className="link-button" onClick={()=>{paperExecutionOwner().stop();paperExecutionOwner().start();}}>Retry matching</button>:null}
    {inspection!==undefined?<div data-testid="paper-matching-details" role="status">
      <p>Browser snapshot · select Matching details to refresh.</p>
      <p>This tab: {role.phase??role.status} · generation {role.epoch}</p>
      {typeof inspection==="string"?<p>{inspection}</p>:<><p>Matching access: {inspection.executionHeld} held, {inspection.executionWaiting} waiting. Account writes: {inspection.writesHeld} held, {inspection.writesWaiting} waiting.</p><p>Matching browser contexts: {inspection.matchingContexts??"unavailable"}. Holder also waiting: {inspection.holderAlsoWaiting===null?"unavailable":inspection.holderAlsoWaiting?"yes":"no"}.</p><p>A held lock does not confirm that its browser context is processing market data. Access is never forcibly taken from another context.</p></>}
    </div>:null}
  </div>;
}
