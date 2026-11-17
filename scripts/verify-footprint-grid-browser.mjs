import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-grid.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint grid lifecycle verification</title><style>body{margin:0;font:14px Arial;background:white;color:#131722}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:3px}output{display:block;padding:8px 0}#chart{height:540px}</style><header><h1>SIMULATED · asynchronous Footprint venue-grid lifecycle</h1><p>Frozen synthetic archive, no live quotes/trades. Resolve the test metadata callback to update five profiles and the visible aggregate.</p><button id="resolve" disabled>Resolve venue precision</button><button id="settings">Footprint settings</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => console.log("Footprint grid verification: http://127.0.0.1:4321"));
