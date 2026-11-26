export interface ChartSnapshot {image:string;filename:string;width:number;height:number;title:string;source:string;capturedAt:string;scope?:"chart"|"layout";chartCount?:number}
interface SnapshotOptions {symbol:string;timeframe:string;title:string;source:string;cssWidth:number;background:string;textColor:string;time?:number}
/** Freeze Vela's synchronous canvas composite, with explicit chart/source identity in the PNG itself. */
export function captureChartSnapshot(renderer:{screenshotCanvas:()=>HTMLCanvasElement|null},options:SnapshotOptions):ChartSnapshot{
  const chart=renderer.screenshotCanvas();if(!chart||chart.width<=0||chart.height<=0)throw new Error("The chart is not ready for a snapshot.");
  const canvas=document.createElement("canvas"),ratio=Number.isFinite(options.cssWidth)&&options.cssWidth>0?Math.max(.5,Math.min(8,chart.width/options.cssWidth)):1,header=Math.round(34*ratio);
  canvas.width=chart.width;canvas.height=chart.height+header;const ctx=canvas.getContext("2d");if(!ctx)throw new Error("This browser cannot create a chart snapshot.");
  const capturedAt=new Date(options.time??Date.now()).toISOString();
  ctx.fillStyle=options.background;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(chart,0,header);ctx.save();ctx.scale(ratio,ratio);ctx.fillStyle=options.textColor;ctx.font='12px "Trebuchet MS",Arial,sans-serif';ctx.textBaseline="middle";
  const text=`${options.source} · ${options.title} · ${options.timeframe} · ${capturedAt.replace("T"," ").slice(0,19)} UTC`,width=canvas.width/ratio-20;
  let label=text;if(ctx.measureText(label).width>width){let low=0,high=text.length;while(low<high){const mid=Math.ceil((low+high)/2);if(ctx.measureText(text.slice(0,mid)+"…").width<=width)low=mid;else high=mid-1;}label=low?text.slice(0,low)+"…":"";}
  ctx.fillText(label,10,17);ctx.restore();
  const image=canvas.toDataURL("image/png");if(!image.startsWith("data:image/png;base64,"))throw new Error("The browser did not produce a PNG snapshot.");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional filename control-character sanitization
  const safe=(value:string)=>value.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_");
  return{image,filename:safe(`${options.symbol}-${options.timeframe}-${options.source}.png`),width:canvas.width,height:canvas.height,title:options.title,source:options.source,capturedAt};
}

export interface SnapshotTile {id:string;canvas:HTMLCanvasElement;left:number;top:number;width:number;height:number;title:string;timeframe:string;source:string;symbol?:string}
export function layoutSnapshotGeometry(tiles:readonly SnapshotTile[]){
  if(!tiles.length)throw new Error("No visible charts are ready for a snapshot.");
  if(new Set(tiles.map(t=>t.id)).size!==tiles.length)throw new Error("The chart layout changed. Retry the snapshot.");
  for(const t of tiles)if(![t.left,t.top,t.width,t.height,t.canvas.width,t.canvas.height].every(Number.isFinite)||t.width<=0||t.height<=0||t.canvas.width<=0||t.canvas.height<=0)throw new Error("A visible chart is not ready for a snapshot.");
  const left=Math.min(...tiles.map(t=>t.left)),top=Math.min(...tiles.map(t=>t.top)),rows:number[]=[];
  for(const y of tiles.map(t=>t.top).sort((a,b)=>a-b))if(!rows.some(r=>Math.abs(r-y)<1))rows.push(y);
  const ratio=Math.max(.5,Math.min(8,...tiles.map(t=>t.canvas.width/t.width)));
  return{ratio,width:Math.ceil((Math.max(...tiles.map(t=>t.left+t.width))-left)*ratio),height:Math.ceil((Math.max(...tiles.map(t=>t.top+t.height))-top+34*rows.length)*ratio),tiles:tiles.map(t=>({...t,x:(t.left-left)*ratio,y:(t.top-top+34*rows.findIndex(r=>Math.abs(r-t.top)<1))*ratio,w:t.width*ratio,h:t.height*ratio,header:34*ratio}))};
}
/** Preserve visible cell positions and each native canvas's aspect ratio in one frozen PNG. */
export function captureLayoutSnapshot(tiles:readonly SnapshotTile[],options:{background:string;textColor:string;time?:number}):ChartSnapshot{
  const layout=layoutSnapshotGeometry(tiles),canvas=document.createElement("canvas");canvas.width=layout.width;canvas.height=layout.height+Math.ceil(22*layout.ratio);
  const ctx=canvas.getContext("2d");if(!ctx)throw new Error("This browser cannot create a layout snapshot.");
  const capturedAt=new Date(options.time??Date.now()).toISOString();ctx.fillStyle=options.background;ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const tile of layout.tiles){
    ctx.save();ctx.beginPath();ctx.rect(tile.x,tile.y,tile.w,tile.h+tile.header);ctx.clip();
    const fit=Math.min(tile.w/tile.canvas.width,tile.h/tile.canvas.height),w=tile.canvas.width*fit,h=tile.canvas.height*fit;
    ctx.drawImage(tile.canvas,tile.x+(tile.w-w)/2,tile.y+tile.header+(tile.h-h)/2,w,h);
    ctx.font=`${12*layout.ratio}px "Trebuchet MS",Arial,sans-serif`;ctx.fillStyle=options.textColor;ctx.textBaseline="middle";
    const text=`${tile.source} · ${tile.symbol??tile.title} · ${tile.timeframe}${tile.symbol?` · ${tile.title}`:""}`,available=Math.max(0,tile.w-20*layout.ratio);
    let label=text;if(ctx.measureText(label).width>available){let low=0,high=text.length;while(low<high){const mid=Math.ceil((low+high)/2);if(ctx.measureText(text.slice(0,mid)+"…").width<=available)low=mid;else high=mid-1;}label=low?text.slice(0,low)+"…":"";}
    ctx.fillText(label,tile.x+10*layout.ratio,tile.y+17*layout.ratio);ctx.strokeStyle=options.textColor;ctx.globalAlpha=.25;ctx.strokeRect(tile.x+.5,tile.y+.5,tile.w-1,tile.h+tile.header-1);ctx.restore();
  }
  ctx.fillStyle=options.textColor;ctx.font=`${11*layout.ratio}px "Trebuchet MS",Arial,sans-serif`;ctx.textBaseline="middle";ctx.fillText(`${capturedAt.replace("T"," ").slice(0,19)} UTC · ${tiles.length} charts`,10*layout.ratio,layout.height+11*layout.ratio);
  const image=canvas.toDataURL("image/png");if(!image.startsWith("data:image/png;base64,"))throw new Error("The browser did not produce a PNG snapshot.");
  return{image,filename:`Affentrader-${tiles.length}-charts.png`,width:canvas.width,height:canvas.height,title:`Visible layout · ${tiles.length} charts`,source:new Set(tiles.map(t=>t.source)).size===1?tiles[0].source:"Mixed sources",capturedAt,scope:"layout",chartCount:tiles.length};
}
