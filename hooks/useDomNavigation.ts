"use client";
import { useEffect, useState } from "react";
import { domNavigation, followDom, scrollDom, type DomFollowMode, type DomNavigation } from "@/lib/orderflow/domNavigation";
import {domVisibleRows} from "@/lib/orderflow/domStyle";

export function useDomNavigation(key: string, target: number | null, now: number, mode:DomFollowMode, delay:number,metrics:{row:number;head:number}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null), [visibleRows, setVisibleRows] = useState(13);
  const upperRows=Math.floor(visibleRows/2),halfRows=Math.max(0,upperRows-1);
  const [stored, setStored] = useState<{key:string;value:DomNavigation} | null>(null);
  const initial = () => domNavigation(target ?? 1);
  const current = stored?.key === key ? stored.value : initial();
  useEffect(() => {
    if (target === null) { setStored(old => old?.key === key ? old : null); return; }
    setStored(old => {
      const value = old?.key === key ? old.value : initial();
      const next = followDom(value, {target,halfRows,mode,delay,now});
      return old?.key === key && next === old.value ? old : {key,value:next};
    });
  }, [key,target,halfRows,mode,delay,now]);
  const move = (rows:number) => { if (target !== null) setStored(old => ({key,value:scrollDom(old?.key === key ? old.value : initial(),rows,target)})); };
  useEffect(() => {
    if (!element) return;
    const resize = () => setVisibleRows(domVisibleRows(element.clientHeight,metrics));
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [element,metrics.row,metrics.head]);
  useEffect(() => {
    if (!element || target === null) return;
    const wheel = (event:WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX)>Math.abs(event.deltaY) || !event.deltaY) return;
      event.preventDefault();
      setStored(old => ({key,value:scrollDom(old?.key === key ? old.value : initial(),-3*Math.sign(event.deltaY),target)}));
    };
    element.addEventListener("wheel",wheel,{passive:false});
    return () => element.removeEventListener("wheel",wheel);
  }, [element,key,target]);
  const hover = (hovered:boolean) => setStored(old => ({key,value:{...(old?.key === key ? old.value : initial()),hovered,leftAt:hovered ? null : Date.now(),scrollTarget:null}}));
  return { mode,delay,halfRows,upperRows,visibleRows,center:current.center,setElement,move,hover,
    recenter:() => target !== null && setStored({key,value:{...current,center:target,scrollTarget:null}}) };
}
