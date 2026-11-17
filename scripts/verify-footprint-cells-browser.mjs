import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-cells.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint cells verification</title>
<style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block}#chart{height:550px}</style>
<header><h1>Footprint counts and average sizes · SIMULATED TEST FIXTURE</h1><p>Raw rows: bid/ask 8/20 and 1/10. Mean-size rows: 8/2 and 1/10. Numeric volume labels stay raw; the POC moves from 100 to 101.</p>
<button id="raw" disabled>Raw volume</button><button id="average" disabled>Average shapes</button><button id="counts" disabled>Bid × Ask trade counts</button><button id="missing" disabled>Missing counts</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => process.stdout.write("Footprint cells fixture: http://127.0.0.1:4321\n"));
