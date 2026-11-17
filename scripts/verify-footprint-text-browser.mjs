import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-text.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint text controls</title><style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px}output{display:block;padding:8px 0}#chart{height:520px}</style><header><h1>SIMULATED · Footprint text planning and fitting</h1><p>Frozen classified rows, no live ticks. Compare Auto, manual 24px without fitting, and fitting inside the actual row shapes. Compact labels retain raw quantities; per-side zeros are blank.</p><button id="auto">Auto text</button> <button id="manual">Manual 24px</button> <button id="fit">Fit numbers</button> <button id="settings">Footprint settings</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => console.log("Footprint text fixture: http://127.0.0.1:4321"));
