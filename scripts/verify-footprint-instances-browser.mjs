import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-instances.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Five footprints per candle</title>
<style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin-bottom:8px}output{display:block;font-size:12px}#chart{height:540px}</style>
<header><h1>Five independent Footprints on one candle · SIMULATED</h1><p>One shared execution tape; separate modes, row grids, positions and styles. Native settings persist on this isolated test origin.</p>
<button id="settings" disabled>Footprint settings</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => process.stdout.write("Footprint instances fixture: http://127.0.0.1:4321\n"));
