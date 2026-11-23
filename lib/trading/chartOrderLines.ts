"use client";
import {registerRendererLayer,type RendererLayerArgs} from "@luxalgo/vela";
import {contextForCanvas} from "@/lib/chart/cellContext";
import {activeAccount,usePaperStore} from "@/stores/usePaperStore";
import {formatPrice} from "@/lib/symbols";
import {paperCommands} from "./paperCommands";
import {draggedOrderPrice,orderLineLevels,placeOrderLines,type OrderLinePlacement} from "./orderLineGeometry";
import type {Order,OrderPatch} from "./broker";
import {paintOrderLineLabel} from "./orderLineLabel";
export interface OrderLineReview {order:Order;draft?:OrderPatch;context:{mode:"live"|"replay";epoch:number}}
const editors=new Map<string,(review:OrderLineReview)=>void>();
export function bindOrderLineEditor(cell:string,editor:(review:OrderLineReview)=>void){editors.set(cell,editor);return()=>{if(editors.get(cell)===editor)editors.delete(cell);};}
export function registerChartOrderLines(){
  registerRendererLayer({id:"af-order-controls",placement:"above-data",create:()=>{
    let canvas:HTMLCanvasElement|undefined,root:HTMLDivElement|undefined,last:RendererLayerArgs|undefined,off:(()=>void)|undefined,frame=0;
    let parkedSize:{width:number;height:number}|undefined;
    const setBackingSize=(element:HTMLCanvasElement,width:number,height:number)=>{
      if(element.width!==width)element.width=width;
      if(element.height!==height)element.height=height;
    };
    const parkBacking=(element:HTMLCanvasElement)=>{
      if(element.width>0&&element.height>0){
        parkedSize={width:element.width,height:element.height};
        setBackingSize(element,0,0);
      }
    };
    type Review=OrderLineReview&{line:OrderLinePlacement};
    type Row={element:HTMLDivElement;edit:HTMLButtonElement;cancel:HTMLButtonElement;review:Review;gesture?:{review:Review;pointer:number;start:number;delta:number}};
    const rows=new Map<string,Row>();
    let cachedOrders: readonly Order[] | undefined, cachedSymbol: string | undefined;
    let levels: ReturnType<typeof orderLineLevels> = [];
    const clear = (ctx: CanvasRenderingContext2D | null, element: HTMLCanvasElement) => {
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      ctx?.clearRect(0, 0, element.width, element.height);
    };
    const hide = (element: HTMLCanvasElement, container: HTMLDivElement) => {
      if (!rows.size) { parkBacking(element); return; }
      container.hidden = true;
      for (const row of rows.values()) row.element.remove();
      rows.clear();
      clear(element.getContext("2d"), element);
      parkBacking(element);
    };
    const render=(args:RendererLayerArgs)=>{
      last=args;if(!canvas||!root)return;
      const context = contextForCanvas(canvas), state = usePaperStore.getState();
      if (!context || (state.mode === "replay") !== context.replay) { hide(canvas, root); return; }
      const orders = activeAccount(state).orders;
      if (cachedOrders !== orders || cachedSymbol !== context.symbol) {
        cachedOrders = orders;
        cachedSymbol = context.symbol;
        levels = orderLineLevels(orders, context.symbol);
      }
      if (!levels.length) { hide(canvas, root); return; }
      const lines = placeOrderLines(levels, price => args.coords.priceToY(price, args.scale, args.bounds), args.bounds.top, args.bounds.height);
      if (!lines.length) { hide(canvas, root); return; }
      const host=canvas.closest<HTMLElement>("[data-vela-cell]");if(!host)return;
      if (parkedSize) {
        if (canvas.width === 0 && canvas.height === 0) setBackingSize(canvas, parkedSize.width, parkedSize.height);
        parkedSize = undefined;
      }
      const ctx = canvas.getContext("2d");
      clear(ctx, canvas);
      if (root.hidden) root.hidden = false;
      const rect=canvas.getBoundingClientRect(),parent=(root.parentElement??host).getBoundingClientRect(),left=rect.left-parent.left,top=rect.top-parent.top;
      const visible=new Set(lines.map(line=>line.id));for(const [id,row] of rows)if(!visible.has(id)){row.element.remove();rows.delete(id);}
      if(ctx){ctx.scale(args.coords.dpr,args.coords.dpr);ctx.save();ctx.beginPath();ctx.rect(0,args.bounds.top,args.coords.width,args.bounds.height);ctx.clip();}
      for(const line of lines){
        const review:Review={order:{...line.order},context:{mode:state.mode,epoch:state.contextEpoch},line};
        let row=rows.get(line.id);
        if(!row){
          const element=document.createElement("div"),edit=document.createElement("button"),cancel=document.createElement("button");element.className="chart-order-line";edit.type=cancel.type="button";edit.className="chart-order-price";cancel.className="chart-order-cancel";cancel.textContent="×";element.append(edit,cancel);root.append(element);
          row={element,edit,cancel,review};rows.set(line.id,row);const entry=row;
          const open=(snapshot:Review,draft?:OrderPatch)=>editors.get(context.id)?.({order:snapshot.order,context:snapshot.context,draft});
          edit.onpointerdown=event=>{if(event.button!==0)return;event.stopPropagation();entry.gesture={review:entry.review,pointer:event.pointerId,start:event.clientY,delta:0};edit.setPointerCapture(event.pointerId);};
          edit.onpointermove=event=>{const gesture=entry.gesture;if(!gesture||gesture.pointer!==event.pointerId||!last)return;event.stopPropagation();gesture.delta=event.clientY-gesture.start;const price=draggedOrderPrice(gesture.review.line.y,gesture.delta,y=>last!.coords.yToPrice(y,last!.scale,last!.bounds));if(Math.abs(gesture.delta)>3&&price!==null)edit.textContent=`${gesture.review.line.label} @ ${formatPrice(price)}`;};
          edit.onpointerup=event=>{const gesture=entry.gesture;if(!gesture||gesture.pointer!==event.pointerId)return;event.stopPropagation();entry.gesture=undefined;if(edit.hasPointerCapture(event.pointerId))edit.releasePointerCapture(event.pointerId);if(Math.abs(gesture.delta)>3&&last){const price=draggedOrderPrice(gesture.review.line.y,gesture.delta,y=>last!.coords.yToPrice(y,last!.scale,last!.bounds));if(price!==null)open(gesture.review,{[gesture.review.line.field]:price});}else open(gesture.review);if(last)render(last);};
          edit.onpointercancel=()=>{entry.gesture=undefined;if(last)render(last);};
          edit.onclick=event=>{event.stopPropagation();if(event.detail===0)open(entry.review);};
          cancel.onpointerdown=event=>event.stopPropagation();cancel.onclick=event=>{event.stopPropagation();const current=entry.review;void paperCommands.cancelReviewed(current.order.id,current.order.revision??0,current.context);};
        }
        row.review=review;row.element.style.left=`${left+Math.max(4,args.coords.width-260)}px`;row.element.style.top=`${top+line.labelY-10}px`;row.element.style.setProperty("--order-color",line.color);row.element.style.maxWidth=`${Math.max(0,Math.min(252,args.coords.width-8))}px`;
        if(!row.gesture)row.edit.textContent=`${line.label} @ ${formatPrice(line.price)}`;
        row.edit.setAttribute("aria-label",`Modify chart order ${line.order.id} ${line.field}`);row.edit.title="Click to modify; drag vertically to review a new price";row.cancel.setAttribute("aria-label",`Cancel chart order ${line.order.id} ${line.field}`);
        if(ctx){ctx.strokeStyle=line.color;ctx.lineWidth=1;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(0,line.y);ctx.lineTo(args.coords.width,line.y);ctx.stroke();if(Math.abs(line.y-line.labelY)>1){const x=Math.max(4,args.coords.width-260);ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x-8,line.y);ctx.lineTo(x,line.labelY);ctx.stroke();}}
      }
      if (ctx) {
        const background = getComputedStyle(root).getPropertyValue("--panel").trim() || args.theme.background;
        for (const line of lines) paintOrderLineLabel(ctx, { x: Math.max(4, args.coords.width - 260), y: line.labelY, maxWidth: Math.max(0, Math.min(252, args.coords.width - 8)), text: `${line.label} @ ${formatPrice(line.price)}`, color: line.color, background });
      }
      ctx?.restore();
    };
    return{
      mount:(element:HTMLCanvasElement)=>{
        canvas=element;
        parkedSize={width:element.width,height:element.height};
        setBackingSize(element,0,0);
        const host=element.closest<HTMLElement>("[data-vela-cell]");if(!host)return;
        root=document.createElement("div");root.className="chart-order-lines";root.hidden=true;(host.parentElement??host).append(root);
        off=usePaperStore.subscribe((state,previous)=>{if(state.live===previous.live&&state.replay===previous.replay&&state.mode===previous.mode&&state.contextEpoch===previous.contextEpoch)return;if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(last)render(last);});});
      },
      resizeBacking:(width:number,height:number)=>{
        if(parkedSize)parkedSize={width,height};
        else if(canvas)setBackingSize(canvas,width,height);
      },
      render,
      destroy:()=>{off?.();if(frame)cancelAnimationFrame(frame);root?.remove();rows.clear();cachedOrders=undefined;levels=[];last=undefined;parkedSize=undefined;canvas=undefined;root=undefined;},
    };
  }});
}
