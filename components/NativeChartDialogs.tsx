"use client";
import {useEffect,useRef} from "react";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {chartTheme} from "@/lib/chart/theme";
/** Native renderer dialogs use the full workspace instead of being clipped by a small chart cell. */
export function NativeChartDialogs(){
  const ref=useRef<HTMLDivElement>(null);
  const theme=useWorkspaceStore(s=>s.theme);
  useEffect(()=>{let live=true;const host=ref.current;void import("@luxalgo/vela/ui").then(ui=>{if(live&&host)ui.ensureUIHost(host,chartTheme(theme));});return()=>{live=false;};},[theme]);
  useEffect(()=>{
    const host=ref.current;if(!host)return;
    const label=()=>{
      for(const panel of host.querySelectorAll<HTMLElement>(".vela-dialog--settings")){panel.setAttribute("role","dialog");panel.setAttribute("aria-label","Chart settings");panel.setAttribute("aria-modal","false");}
      for(const row of host.querySelectorAll<HTMLElement>(".vela-field-bool,.vela-field-toggle-label")){
        const control=row.querySelector('[role="switch"]'),text=row.querySelector(".vela-field-label")?.textContent?.trim();if(control&&text)control.setAttribute("aria-label",text);
      }
      for(const close of host.querySelectorAll(".vela-dialog-close"))close.setAttribute("aria-label","Close chart dialog");
    };
    const observer=new MutationObserver(label);observer.observe(host,{childList:true,subtree:true});label();return()=>observer.disconnect();
  },[]);
  return <div ref={ref} id="native-chart-dialog-host" className="native-chart-dialog-host"/>;
}
