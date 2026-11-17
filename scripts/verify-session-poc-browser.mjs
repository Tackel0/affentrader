import { build } from "esbuild";
import { createServer } from "node:http";
const bundle=await build({entryPoints:["tests/browser/session-poc-extension.ts"],bundle:true,format:"esm",platform:"browser",write:false});
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session POC extension verification</title>
<style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block}#chart{height:550px}</style>
<header><h1>Session POC extension · SIMULATED TEST FIXTURE</h1><p>Completed 12:00–13:00 UTC profile. Later candle ranges determine contact; this is not market data.</p>
<button id="untouched" disabled>Untested POC</button><button id="touch" disabled>Touch POC at 13:05</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((request,response)=>{if(request.url==="/"){response.writeHead(200,{"content-type":"text/html","cache-control":"no-store"});response.end(html);}
else if(request.url==="/fixture.js"){response.writeHead(200,{"content-type":"application/javascript","cache-control":"no-store"});response.end(bundle.outputFiles[0].contents);}
else{response.writeHead(404);response.end();}}).listen(4321,"127.0.0.1",()=>process.stdout.write("Session POC fixture: http://127.0.0.1:4321 (loopback only)\n"));
