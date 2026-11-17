/** Raster counterpart of the interactive DOM label, also included in Vela PNG snapshots. */
export function paintOrderLineLabel(ctx:CanvasRenderingContext2D,options:{x:number;y:number;maxWidth:number;text:string;color:string;background:string}){
  const {x,y,maxWidth,text,color,background}=options;
  if(![x,y,maxWidth].every(Number.isFinite)||maxWidth<30)return;
  ctx.save();ctx.font='11px "Trebuchet MS",Arial,sans-serif';ctx.textBaseline="middle";ctx.textAlign="left";
  const width=Math.min(maxWidth,ctx.measureText(text).width+36),available=width-36;
  let label=text;
  if(ctx.measureText(label).width>available){let low=0,high=text.length;while(low<high){const mid=Math.ceil((low+high)/2);if(ctx.measureText(text.slice(0,mid)+"…").width<=available)low=mid;else high=mid-1;}label=low?text.slice(0,low)+"…":"";}
  ctx.fillStyle=background;ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([]);ctx.fillRect(x,y-10,width,20);ctx.strokeRect(x+.5,y-9.5,width-1,19);
  ctx.beginPath();ctx.moveTo(x+width-22,y-10);ctx.lineTo(x+width-22,y+10);ctx.stroke();ctx.fillStyle=color;ctx.fillText(label,x+6,y+.5);ctx.font='15px "Trebuchet MS",Arial,sans-serif';ctx.fillText("×",x+width-16,y+.5);ctx.restore();
}
