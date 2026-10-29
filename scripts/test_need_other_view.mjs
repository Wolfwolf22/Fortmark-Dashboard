/** Render the real need editor/read view with synthetic Other descriptions. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "fortmark-needs-other-"));
try {
  const entry = `
    import assert from "node:assert/strict";
    import React from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {NeedSummary} from "./components/leads/need-summary";
    import {NeedForm} from "./components/leads/lead-needs";
    const base = {id:"synthetic",kind:"other",kindOther:"Relocation <consultation>",status:"active",areas:[],propertyTypes:["other"],propertyTypeOther:"Co-op <home>",priceMinCents:null,priceMaxCents:null,minBeds:null,minBaths:null,minSqft:null,targetDate:null,timelineNote:null,financing:"other",financingOther:"Seller <financing>",mustHaves:[],avoid:[],additionalRequirements:null,createdAt:"2026-10-29T15:00:00Z",updatedAt:"2026-10-29T15:00:00Z"};
    const initial={kind:base.kind,kindOther:base.kindOther,areas:[],propertyTypes:base.propertyTypes,propertyTypeOther:base.propertyTypeOther,priceMin:"",priceMax:"",minBeds:"",minBaths:"",targetDate:"",timelineNote:"",minSqft:"",financing:base.financing,financingOther:base.financingOther,mustHaves:[],avoid:[],additional:""};
    let checks=0;
    function check(name,value){assert.ok(value,name);checks++;}
    for(const status of ["active","paused","fulfilled","archived"]){
      const html=renderToStaticMarkup(React.createElement(NeedSummary,{need:{...base,status}}));
      for(const text of ["Relocation &lt;consultation&gt;","Co-op &lt;home&gt;","Seller &lt;financing&gt;"]) check(status+": custom text readable and escaped",html.includes(text));
      check(status+": no edit permission needed for descriptions",!html.includes("<button"));
      check(status+": custom descriptions count as details",!html.includes("No details added yet."));
    }
    const props={initial,saving:false,onSubmit:()=>{},onCancel:()=>{},submitLabel:"Save need"};
    const all=renderToStaticMarkup(React.createElement(NeedForm,props));
    for(const [id,value] of [["need-kind-other","Relocation &lt;consultation&gt;"],["need-property-type-other","Co-op &lt;home&gt;"],["need-financing-other","Seller &lt;financing&gt;"]]){
      const input=all.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];
      check(id+": writable labeled input is present",Boolean(input)&&!input.includes('disabled=""'));
      check(id+": saved value pre-fills",input?.includes('value="'+value+'"'));
      check(id+": bounded required description",input?.includes('maxLength="200"')&&input.includes('aria-required="true"'));
      check(id+": label targets field",all.includes('for="'+id+'"'));
    }
    const ordinary=renderToStaticMarkup(React.createElement(NeedForm,{...props,initial:{...initial,kind:"buy",propertyTypes:["condo"],financing:"cash"}}));
    for(const id of ["need-kind-other","need-property-type-other","need-financing-other"]) check(id+": inactive draft field stays hidden",!ordinary.includes('id="'+id+'"'));
    const legacy=renderToStaticMarkup(React.createElement(NeedForm,{...props,initial:{...initial,kindOther:"",propertyTypeOther:"",financingOther:""}}));
    for(const id of ["need-kind-other","need-property-type-other","need-financing-other"]) check(id+": legacy selection exposes input to complete description",legacy.includes('id="'+id+'"'));
    const legacyRead=renderToStaticMarkup(React.createElement(NeedSummary,{need:{...base,kindOther:null,propertyTypeOther:null,financingOther:null}}));
    check("legacy missing custom text remains readable",legacyRead.includes("Other")&&!legacyRead.includes("undefined")&&!legacyRead.includes("null"));
    console.log(checks+"/"+checks+" actual Other need form/read checks passed");
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false });
  const path = join(temp, "other-view.cjs");
  writeFileSync(path, output.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [path], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Other need view checks failed");
} finally { rmSync(temp, { recursive: true, force: true }); }
