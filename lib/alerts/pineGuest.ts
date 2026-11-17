/** Runs wholly inside QuickJS. Only JSON series and Intl-formatting bridges are exposed. */
export const PINE_GUEST = String.raw`
(()=>{
  const NativeDate=Date;
  let clock=0, snapshot, primary, runtime, context, indicator, priming=true, target=0, hasCalls=false, strategyCloseOnly=false;
  let conditions=new Map(), seen=new Set(), declarations=new Map(), previousFrame='', execute, liveLedger, liveClosed=[], fillOrdinal=0, observation='';
  globalThis.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} };
  globalThis.console={log(){},warn(){},error(){},info(){},debug(){}};
  globalThis.Intl={DateTimeFormat:class {
    constructor(locale,options){this.args={locale,options};}
    formatToParts(value){return JSON.parse(__intl(JSON.stringify({...this.args,method:'parts',value:Number(value)})));}
    format(value){return JSON.parse(__intl(JSON.stringify({...this.args,method:'format',value:Number(value)})));}
    resolvedOptions(){return JSON.parse(__intl(JSON.stringify({...this.args,method:'options'})));}
  }};
  const scalar=x=>x&&typeof x.get==='function'?x.get(0):x;
  const named=(args,names)=>{
    const out=args.slice(),bag=out[out.length-1];
    if(bag&&Object.getPrototypeOf(bag)===Object.prototype&&Object.keys(bag).some(k=>names.includes(k))){out.pop();for(const key of names)if(key in bag)out[names.indexOf(key)]=bag[key];}
    return out.map(scalar);
  };
  const info=series=>({description:series.symbol,ticker:series.symbol,tickerid:series.symbol,main_tickerid:series.symbol,timezone:'Etc/UTC',currency:'',session:'24x7',type:'crypto',...series.info});
  const seriesKey=(symbol,tf)=>symbol+'|'+tf;
  let series=new Map();
  const heikinBars=new Map();
  const preparePrimary=frame=>{
    let data=frame.series;
    if(snapshot.chartType==='heikinashi'){
      let previous;
      const bars=data.bars.map((bar,index)=>{
        if(!index)previous=[...heikinBars.values()].filter(value=>value.time<bar.time).at(-1);
        const open=previous?(previous.open+previous.close)/2:(bar.open+bar.close)/2,close=(bar.open+bar.high+bar.low+bar.close)/4;
        const value={...bar,open,close,high:Math.max(bar.high,open,close),low:Math.min(bar.low,open,close)};
        heikinBars.set(bar.time,value);previous=value;return value;
      });
      const keep=new Set(bars.map(bar=>bar.time));const before=[...heikinBars.keys()].filter(time=>!keep.has(time)).sort((a,b)=>a-b);
      for(const time of before.slice(0,-1))heikinBars.delete(time);
      data={...data,bars};
    }
    return data;
  };
  const frameKey=frame=>JSON.stringify([primary.bars.at(-1),frame.closedBar,frame.observation]);
  const saveLedger=$=>{liveLedger=PineAlertRuntime.snapshotStrategyState($.strategy);liveClosed=$.strategy.closedtrades.slice();};
  const restoreLedger=$=>{PineAlertRuntime.restoreStrategyState($.strategy,liveLedger);$.strategy.closedtrades=liveClosed.slice();};
  const livePhase=async($,phase)=>{
    if($.isSecondaryContext)return false;
    const bar=$.marketData[$.idx];
    if(priming){if(phase==='after'&&bar.closeTime>clock){PineAlertRuntime.processLiveStrategyClose($,false);return true;}return false;}
    if(bar.openTime!==target)return false;
    const confirmed=bar.closeTime<=clock;
    if(phase==='before'){
      restoreLedger($);$.strategy._alertLive=true;
      if(!globalThis.__pine.closedObservation){
        const fills=PineAlertRuntime.processLiveStrategyPoint($);
        if(fills&&$.strategy.config.calc_on_order_fills){$._alertFillRecalc=true;try{await execute($);}finally{$._alertFillRecalc=false;}}
      }
    }else{
      let iterations=0;
      for(;;){
        const fills=PineAlertRuntime.processLiveStrategyClose($,confirmed);
        if(!fills||!$.strategy.config.calc_on_order_fills)break;
        if(++iterations>32)throw Error('Too many immediate strategy fill recalculations.');
        $._alertFillRecalc=true;try{await execute($);}finally{$._alertFillRecalc=false;}
      }
      saveLedger($);
    }
    return true;
  };
  const getSeries=async(symbol,tf,limit)=>{
    const key=seriesKey(symbol,tf);
    if(series.has(key))return series.get(key);
    const data=JSON.parse(await __series(JSON.stringify({symbol,timeframe:tf,count:Math.min(limit||snapshot.history,20000)})));
    series.set(key,data);return data;
  };
  const rows=data=>data.bars.map(b=>({openTime:b.time,closeTime:b.end,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
  const provider={configure(value){if(value&&Object.keys(value).length)throw Error('A saved alert data source cannot be reconfigured.');},
    async getMarketData(symbol,tf,limit,from,to){const data=await getSeries(symbol,tf,limit);let result=rows(data).filter(b=>(from===undefined||b.openTime>=from)&&(to===undefined||b.openTime<to));return limit?result.slice(-limit):result;},
    async getSymbolInfo(symbol){return info(await getSeries(symbol,primary.timeframe,snapshot.history));}
  };
  const wrap=(prepared)=>{
    const original=prepared.fn;
    const fn=async $=>{
      const bar=$.marketData[$.idx],time=bar.openTime,isTarget=!priming&&time===target;
      if(declarations.get(indicator)==='strategy'&&!$.isSecondaryContext)$._liveStrategyPhase=livePhase;
      $.chartStyle=snapshot.chartType==='heikinashi'?'heikinashi':'standard';
      const barstate=$.pine.barstate;
      Object.defineProperties(barstate,{
        isrealtime:{configurable:true,get:()=>isTarget},
        ishistory:{configurable:true,get:()=>!isTarget},
        isnew:{configurable:true,get:()=>!seen.has(time)},
        isconfirmed:{configurable:true,get:()=>bar.closeTime<=clock}
      });
      let ordinal=0;
      $.pine.alertcondition=(...args)=>{
        const [condition,title,message]=named(args,['condition','title','message']);
        const id='alertcondition_'+ordinal++;
        conditions.set(id,{id,title:String(title||id),message:String(message||'')});
        if(condition&&isTarget&&declarations.get(indicator)==='indicator')$.alerts.push({type:'alertcondition',id,title:String(title||id),message:String(message||''),bar_index:$.idx,time});
      };
      if(declarations.get(indicator)!=='strategy'||!strategyCloseOnly||bar.closeTime<=clock||$._alertFillRecalc)await original($);
      seen.add(time);
    };
    fn._pineVersion=original._pineVersion;execute=fn;
    return {...prepared,fn};
  };
  const inspection=()=>({title:String(context?.indicator?.title||context?.strategy?.config?.title||snapshot.title),declaration:declarations.get(indicator),hasCalls,conditions:declarations.get(indicator)==='indicator'?[...conditions.values()]:[],fillMessage:snapshot.source.match(/^\s*\/\/@strategy_alert_message\s+(.+)$/m)?.[1],
    inputs:indicator.getInputsMeta().map(x=>({id:x.id,varId:x.varId,title:x.title||x.name||x.id,type:x.type,defval:x.defval,min:x.minval,max:x.maxval,options:x.options}))});
  globalThis.__pine={
    async initialize(definition,frame){
      snapshot=definition;clock=frame.now;primary=frame.series;series=new Map([[seriesKey(primary.symbol,primary.timeframe),primary]]);
      indicator=new PineAlertRuntime.Indicator(snapshot.source,snapshot.inputs);
      const resolver=new PineAlertRuntime.FunctionImportResolver(path=>snapshot.libraries[path]??null);
      await indicator.resolveImports(resolver);
      const kind=indicator.getDeclarationType();if(!['indicator','strategy'].includes(kind))throw Error('Use a Pine indicator() or strategy() script.');
      declarations.set(indicator,kind);
      strategyCloseOnly=kind==='strategy'&&!indicator.prop.calc_on_every_tick;
      primary=preparePrimary(frame);if(!primary.bars.length)throw Error('No confirmed strategy candle available.');series=new Map([[seriesKey(primary.symbol,primary.timeframe),primary]]);
      hasCalls=/alert\s*\.\s*any\s*\(/.test(String(indicator.prepare().fn));
      const prepare=indicator.prepare.bind(indicator);indicator.prepare=()=>wrap(prepare());
      runtime=new PineAlertRuntime.PineTS(provider,primary.symbol,primary.timeframe,primary.bars.length);
      runtime.setMaxLoops(100000);runtime.setImportResolver(resolver);runtime.setAlertMode('realtime');runtime.setTimezone(snapshot.timezone);
      context=await runtime.run(indicator);context.alerts=[];priming=false;previousFrame=frameKey(frame);
      if(context.strategy){
        saveLedger(context);context._liveStrategyPhase=livePhase;
        context._onStrategyOrderFill=fill=>{
          const bar=context.marketData[context.idx];if(bar.openTime!==target||!context.strategy._alertLive)return;
          const id=String(target)+':'+observation+':'+(++fillOrdinal);
          context.alerts.push({type:'order_fill',id,time:target,message:'',fill:{...fill,id}});
        };
      }
      return JSON.stringify({inspection:inspection(),signals:[],lastBar:primary.bars.at(-1).time,warnings:context.warnings.map(x=>x.message).slice(-10)});
    },
    async update(frame){
      clock=frame.now;primary=preparePrimary(frame);target=frame.closedBar??primary.bars.at(-1).time;
      globalThis.__pine.closedObservation=frame.closedBar!==undefined;observation=String(frame.observation??clock);fillOrdinal=0;
      const key=frameKey(frame);
      if(key===previousFrame)return JSON.stringify({inspection:inspection(),signals:[],lastBar:target,warnings:[]});
      previousFrame=key;series=new Map([[seriesKey(primary.symbol,primary.timeframe),primary]]);context.alerts=[];
      await runtime.updateTail(context);
      const plotValues={};let plotIndex=0;for(const [key,plot] of Object.entries(context.plots)){const value=plot.data?.at(-1)?.value;if(typeof value==='number'){if(Number.isFinite(value)){plotValues[key]=value;plotValues[String(plotIndex)]=value;}plotIndex++;}}
      if(context.alerts.length>100)throw Error('More than 100 Pine signal events in one observation.');
      const signals=context.alerts.filter(x=>x.time===target).map(x=>({...x,price:x.fill?.price??primary.bars.find(b=>b.time===target)?.close,confirmed:primary.bars.find(b=>b.time===target)?.end<=clock,bar:primary.bars.find(b=>b.time===target),plots:plotValues}));
      return JSON.stringify({inspection:inspection(),signals,lastBar:target,warnings:context.warnings.map(x=>x.message).slice(-10)});
    }
  };
})();`;
