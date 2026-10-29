/** Render the actual read component with ordinary React, without browser/live data. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "fortmark-needs-read-"));
try {
  const entry = `
    import assert from "node:assert/strict";
    import React from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {NeedSummary} from "./components/leads/need-summary";
    const base = {id:"synthetic",kind:"buy",status:"active",areas:[],propertyTypes:[],priceMinCents:null,priceMaxCents:null,minBeds:null,minBaths:null,minSqft:null,targetDate:null,timelineNote:null,financing:"cash",mustHaves:["Wheelchair access"],avoid:["Stairs"],additionalRequirements:"<script>alert(1)</script>",createdAt:"2026-10-29T15:00:00Z",updatedAt:"2026-10-29T15:00:00Z"};
    let checks=0;
    for (const status of ["active","paused","fulfilled","archived"]) {
      const html=renderToStaticMarkup(React.createElement(NeedSummary,{need:{...base,status}}));
      for (const text of ["Financing","Cash","Must-haves","Wheelchair access","Avoid","Stairs","Additional requirements"]) {assert.ok(html.includes(text),status+": "+text);checks++;}
      assert.ok(!html.includes("No details added yet."),status+": stored requirements are details");checks++;
      assert.ok(!html.includes("<button"),status+": read view needs no write controls");checks++;
      assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"),status+": plain text only");checks++;
    }
    const empty=renderToStaticMarkup(React.createElement(NeedSummary,{need:{...base,financing:null,mustHaves:[],avoid:[],additionalRequirements:null}}));
    assert.ok(empty.includes("No details added yet."));checks++;
    console.log(checks+"/"+checks+" actual need read-view checks passed");
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false });
  const path = join(temp, "read-view.cjs");
  writeFileSync(path, output.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [path], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Need read-view checks failed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
