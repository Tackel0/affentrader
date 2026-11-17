"use client";
import {useEffect,useSyncExternalStore} from "react";
import {paperExecutionOwner} from "@/lib/trading/paperOwnership";
import type {ExecutionSnapshot} from "@/lib/browser/coordination";
import {isPopout} from "@/lib/windowScope";
const initial:ExecutionSnapshot={status:"standby",epoch:0};
export function usePaperRole(){return useSyncExternalStore(paperExecutionOwner().subscribe,paperExecutionOwner().snapshot,()=>initial);}
export function usePaperOwnership(){
  const role=usePaperRole();
  useEffect(()=>{if(isPopout())return;const lease=paperExecutionOwner(),start=()=>lease.start(),stop=()=>lease.stop();start();window.addEventListener("pagehide",stop);window.addEventListener("pageshow",start);return()=>{window.removeEventListener("pagehide",stop);window.removeEventListener("pageshow",start);stop();};},[]);
  return role;
}
