import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(name) { const start = source.indexOf(`function ${name}(`, 1097000); assert.ok(start >= 0, name); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const regexStart = source.indexOf("var tI=", 1097000), regexEnd = source.indexOf(";function tR", regexStart); assert.ok(regexStart > 0 && regexEnd > regexStart);
// Only reviewed pure row/paint/color/text helpers, never the application bundle.
const helpers = ["t_", "tk", "tS", "tA", "tC", "tM", "tE", "tT", "tN", "tR", "tL", "tF", "tB", "t$", "tV", "tz", "tj", "ic", "iu", "ip", "im", "id", "ig", "iy", "ib", "iv", "ix", "i_"];
const program = `(()=>{${source.slice(regexStart, regexEnd)};const tO=new Map();${helpers.map(block).join("\n")}return {paint:ix,plan:iu,prepare:tz}})()`;
assert.ok(!program.includes("</script"));
const bundle = await build({ entryPoints: ["tests/browser/footprint-renderer.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint full painter comparison</title><style>body{margin:12px;background:#fafafa;color:#131722;font:14px Arial}h1{font-size:19px}button{padding:8px}section{display:flex;gap:12px;flex-wrap:wrap}canvas{border:1px solid #ddd}pre{white-space:pre-wrap;font-size:12px}</style><h1>SIMULATED · Complete per-profile painter comparison</h1><p>Actual reviewed Vela painter (left), app painter (right). Fixed classified rows and known counts; no side candles, stat tables, extensions or data-source equivalence claim.</p><button id="run">Run matrix</button> <button id="next">Next differing case</button><output id="status">Initializing</output><section><figure><figcaption>Reference</figcaption><canvas id="reference" width="400" height="260"></canvas></figure><figure><figcaption>App</figcaption><canvas id="actual" width="400" height="260"></canvas></figure></section><pre id="report"></pre><script>window.footprintReference=${program};window.footprintReferenceHash=${JSON.stringify(sourceHash)};</script><script type="module" src="/fixture.js"></script>`;
createServer((req, res) => { if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); } else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); } else { res.writeHead(404); res.end(); } }).listen(4321, "127.0.0.1", () => console.log("Footprint full painter comparison: http://127.0.0.1:4321"));
