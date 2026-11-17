"use client";
import { useEffect } from "react";
import { useAlertStore } from "@/stores/useAlertStore";
import { useChartStore } from "@/stores/useChartStore";
import { useServerStore } from "@/stores/useServerStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { drawingArchive,drawingCondition,drawingFingerprint,drawingGeometry } from "@/lib/alerts/drawing";
import { applyDrawingEdit,checkDrawingEdit,type DrawingEditIntent } from "@/lib/alerts/drawingEdits";
import { linkedDrawingAxis } from "@/lib/alerts/drawingProjection";
import { editAlerts } from "@/lib/alerts/browserOwnership";
import { serverAlerts } from "@/lib/alerts/serverClient";
import { isPopout } from "@/lib/windowScope";
import type { AlertRule } from "@/types/alerts";

/** Only actual local edits publish intent. Loading another tab's alert never adopts an older chart. */
export function useDrawingAlerts(){
  useEffect(()=>{
    if(isPopout())return;
    let disposed=false,activeId=useWorkspaceStore.getState().activeId;
    const pending=new Map<string,DrawingEditIntent>(),running=new Set<string>(),failures=new Set<string>();
    const report=(id:string,error:unknown)=>{if(!failures.has(id)){failures.add(id);const name=useAlertStore.getState().rules.find(rule=>rule.id===id)?.name??"Drawing alert";useChartStore.getState().toast("Drawing binding not updated",`${name}: ${error instanceof Error?error.message:String(error)}`,"error");}};
    const drain=async(id:string)=>{
      if(running.has(id))return;running.add(id);
      try{while(!disposed&&pending.has(id)){
        const intent=pending.get(id)!;pending.delete(id);
        try{
          const serverRule=await editAlerts(store=>{
            const rule=store.rules.find(r=>r.id===id);if(!rule)return;
            const result=checkDrawingEdit(rule,intent);if(result==="same")return;
            if(result==="conflict")throw new Error("The linked alert has a newer drawing. Reopen it and save explicitly to bind this chart's drawing.");
            if(rule.serverSide)return {rule,signature:JSON.stringify(rule)};
            const patch=applyDrawingEdit(rule,intent);if(patch)store.updateRule(id,patch);
          },()=>!disposed);
          if(serverRule){
            const key=useServerStore.getState().key;if(!key)throw new Error("Connect the alert server, then reopen the alert to review its drawing.");
            const saved=await serverAlerts.drawing(key,id,intent.expected,intent.geometry??null);
            await editAlerts(store=>{
              const current=store.rules.find(r=>r.id===id);
              if(current&&JSON.stringify(current)===serverRule.signature)store.replaceServerRules([...store.rules.filter(r=>r.serverSide&&r.id!==id),saved.rule]);
            },()=>!disposed);
          }
          failures.delete(id);
        }catch(error){pending.delete(id);report(id,error);}
      }}finally{running.delete(id);}
    };
    const enqueue=(intent:DrawingEditIntent)=>{
      const waiting=pending.get(intent.id);
      if(waiting&&drawingFingerprint(waiting.geometry)!==intent.expected){report(intent.id,new Error("This chart changed from a different drawing revision. Review the alert before binding it again."));return;}
      pending.set(intent.id,{...intent,expected:waiting?.expected??intent.expected});
      void drain(intent.id).catch(error=>report(intent.id,error));
    };
    const capture=(rule:AlertRule,before:ReturnType<typeof drawingArchive>,after:ReturnType<typeof drawingArchive>,beforeAxis:boolean,afterAxis:boolean)=>{
      if(!before||!after||rule.scope.type!=="symbol")return;
      const c=drawingCondition(rule);if(!c)return;
      const geometry=(archive:typeof before,axis:boolean)=>{const native=archive.find(d=>d.id===c.geometry.id&&d.type===c.geometry.type);return native?drawingGeometry(native,axis,c.geometry.chartCellId):undefined;};
      const previous=geometry(before,beforeAxis),next=geometry(after,afterAxis),expected=drawingFingerprint(previous);
      if(expected===drawingFingerprint(next))return;
      enqueue({id:rule.id,symbol:rule.scope.symbol,expected,geometry:next});
    };
    const offCharts=useChartStore.subscribe((state,before)=>{
      const workspace=useWorkspaceStore.getState(),activation=activeId!==workspace.activeId;activeId=workspace.activeId;
      if(state.drawings===before.drawings&&(state.logarithmic===before.logarithmic||activation))return;
      for(const rule of useAlertStore.getState().rules){
        const c=drawingCondition(rule);if(!c||rule.scope.type!=="symbol")continue;
        const archiveChanged=state.drawings[rule.scope.symbol]!==before.drawings[rule.scope.symbol];
        const axisChanged=!activation&&state.logarithmic!==before.logarithmic&&c.geometry.chartCellId===workspace.activeId&&state.symbol===before.symbol&&state.symbol===rule.scope.symbol;
        if(!archiveChanged&&!axisChanged)continue;
        capture(rule,drawingArchive(before.drawings[rule.scope.symbol]),drawingArchive(state.drawings[rule.scope.symbol]),linkedDrawingAxis(c.geometry,rule.scope.symbol,before,workspace),linkedDrawingAxis(c.geometry,rule.scope.symbol,state,workspace));
      }
    });
    const offWorkspace=useWorkspaceStore.subscribe((state,before)=>{
      if(state.cells===before.cells)return;
      for(const rule of useAlertStore.getState().rules){
        const c=drawingCondition(rule),id=c?.geometry.chartCellId;if(!c||!id||id===state.activeId||rule.scope.type!=="symbol")continue;
        const old=before.cells.find(cell=>cell.id===id),next=state.cells.find(cell=>cell.id===id);
        if(!old||!next||old.symbol!==rule.scope.symbol||next.symbol!==rule.scope.symbol||Boolean(old.logarithmic)===Boolean(next.logarithmic))continue;
        const archive=drawingArchive(useChartStore.getState().drawings[rule.scope.symbol]);capture(rule,archive,archive,Boolean(old.logarithmic),Boolean(next.logarithmic));
      }
    });
    return()=>{disposed=true;offCharts();offWorkspace();pending.clear();};
  },[]);
}
