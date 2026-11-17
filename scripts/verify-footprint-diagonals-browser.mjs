import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/footprint-diagonals.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Observed Footprint diagonals</title><style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}#chart{height:520px}output{display:block;padding-top:8px}</style><header><h1>SIMULATED · observed Footprint diagonals</h1><p>3:1 threshold. A: one isolated row. B: actual neighbor with zero opposite side. C: unobserved gap. D: neighbors hidden by min-volume filter. E: two present nonzero diagonals exactly at 3:1.</p><p>Only B's upper ask and E's central bid and ask should have outlines/tinted values. Missing and hidden neighbors supply no flags.</p><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => console.log("Observed diagonals fixture: http://127.0.0.1:4321"));
