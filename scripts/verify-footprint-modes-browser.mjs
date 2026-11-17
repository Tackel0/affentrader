import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-modes.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint mode comparison</title>
<style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block;max-width:1100px}#chart{height:550px}</style>
<header><h1>Five Footprint modes · SIMULATED COMPARISON FIXTURE</h1><p>The same three rows in six separate test candles: Bid × Ask Profile, Ladder, Volume Split, Volume Mono, Delta, Absolute Delta.</p>
<button id="average" disabled>Toggle average sizes</button><button id="gradient" disabled>Toggle gradients</button><button id="histogram" disabled>Toggle histograms</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => process.stdout.write("Footprint modes fixture: http://127.0.0.1:4321\n"));
