import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const label = process.argv[2] ?? "current";
if (!/^[a-z-]+$/.test(label)) throw new Error("Use an alphabetic benchmark label.");
const result = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
  import {technicalRating} from "./lib/ta/rating";
  const rows=[];
  for(const count of [1000,5000,20000]){
    const bars=Array.from({length:count},(_,i)=>{const close=100+i*.001+Math.sin(i/7);return {time:1700000000000+i*60000,open:close-.1,high:close+.3,low:close-.4,close,volume:100+i%17};});
    const start=performance.now(),rating=technicalRating(bars);
    rows.push({count,milliseconds:performance.now()-start,rating});
  }
  console.log(JSON.stringify({verifiedAt:new Date().toISOString(),rows},null,2));
` }, bundle: true, write: false, platform: "node", format: "esm", target: "node24", tsconfig: "tsconfig.json" });
const output = new URL(`../artifacts/technicals-benchmark-${label}-runner.mjs`, import.meta.url);
await writeFile(output, result.outputFiles[0].contents);
await import(output.href);
