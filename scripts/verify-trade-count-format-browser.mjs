import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
// Public recorded sample only; no account data or local authentication settings.
const capture = JSON.parse(await readFile("artifacts/kraken-recorded-replay-live.json", "utf8"));
const source = `import {Vela,registerNativeIndicator} from '@luxalgo/vela';
import {tradeCountDescriptor} from './lib/orderflow/tradeCountIndicator';
import {bindStudyAxisLabels} from './lib/chart/studyAxisLabels';
const trades=${JSON.stringify(capture.trades)};
for(const kind of ['total','delta','cumulative']) registerNativeIndicator(tradeCountDescriptor(kind,()=>trades,()=>()=>{}));
const start=Date.UTC(2026,10,6,10,55), bars=[0,1].map(i=>({time:start+i*60000,open:76040,high:76060,low:76030,close:76045,volume:1}));
const chart=new Vela(document.querySelector('#chart'),{symbol:'KRK:BTC/USD',timeframe:'1m',live:true,theme:'light',volume:false,drawings:{toolbar:false},animations:{intro:false}}, {dataFeed:{load:async()=>bars,subscribe:()=>()=>{},symbolInfo:()=>({ticker:'BTC/USD',type:'crypto',timezone:'UTC',currency:'USD',mintick:.1,pricescale:10,session:'24x7'})}});
chart.ready().then(async()=>{await chart.historyComplete();const handles=['af-trade-count','af-trade-count-delta','af-ctcd'].map(type=>chart.addNativeIndicator(type));
bindStudyAxisLabels(chart.renderer,{read:()=>handles.map(h=>({nativeId:h.id,indicator:{id:h.id,visible:true,valuesOnPriceScale:true}})),subscribe:()=>()=>{}});
document.querySelector('#merge').onclick=()=>handles[2].moveTo('price'); document.querySelector('#merge').disabled=false;
document.querySelector('#read').onclick=()=>{const data=chart.renderer.dataWindowReadout(); document.querySelector('#result').textContent=JSON.stringify(data.groups,null,2);}; document.querySelector('#read').disabled=false;}).catch(e=>document.querySelector('#result').textContent=String(e));`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", platform: "browser", write: false });
const html = '<!doctype html><meta charset="utf-8"><title>Count integer readouts</title><style>body{font:14px Arial;margin:12px}#chart{height:520px}pre{white-space:pre-wrap}</style><h1>Recorded Kraken sample · count formatting</h1><p>Partial public sample, 75 executions. Latest 1m candle: total 17, delta -1, CTCD 8/11/5/7. Price tick 0.1.</p><button id="read" disabled>Read native Data window</button> <button id="merge" disabled>Merge CTCD into price pane</button><div id="chart"></div><pre id="result">Ready to read after chart loads.</pre><script type="module" src="/fixture.js"></script>';
createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(html);}else if(req.url==='/fixture.js'){res.writeHead(200,{'content-type':'application/javascript'});res.end(bundle.outputFiles[0].contents);}else{res.writeHead(404);res.end();}}).listen(4321,'127.0.0.1',()=>console.log('Count formatting fixture: http://127.0.0.1:4321'));
