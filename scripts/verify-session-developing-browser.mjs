import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/session-developing.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Developing session profile verification</title>
<style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block}#chart{height:550px}</style>
<header><h1>Developing POC / VA · SIMULATED TEST FIXTURE</h1><p>Dashed red POC and blue VA from cumulative classified observations. Current session grid; later extrema may rebin earlier points.</p>
<button id="prefix" disabled>Reveal 20 candles</button><button id="full" disabled>Reveal 60 candles</button><button id="poc" disabled>Toggle developing POC</button><button id="va" disabled>Toggle developing VA</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html); }
  else if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(bundle.outputFiles[0].contents); }
  else { response.writeHead(404); response.end(); }
}).listen(4321, "127.0.0.1", () => process.stdout.write("Developing session fixture: http://127.0.0.1:4321 (loopback only)\n"));
