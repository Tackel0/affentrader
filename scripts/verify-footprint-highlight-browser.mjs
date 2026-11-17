import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-highlight.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint independent highlight palettes</title><style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px}output{display:block;padding:8px 0}#chart{height:520px}</style><header><h1>SIMULATED · independent Footprint highlight palettes</h1><p>The central row has both flags at exactly 300%. Outline colors: Bid orange / Ask blue; value colors: Bid cyan / Ask purple. Histograms remain green/red. Centered values use the Ask flag first.</p><button id="settings">Footprint settings</button> <button id="restore">Restore comparison</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => console.log("Footprint highlight fixture: http://127.0.0.1:4321"));
