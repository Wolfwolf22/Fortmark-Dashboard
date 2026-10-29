/** Synthetic, network-free model checks and the actual client-information read UI. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "fortmark-client-info-"));
try {
  const entry = `
    import assert from "node:assert/strict";
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { ClientInfo } from "./components/leads/client-info";
    import { CLIENT_INFO_LIMITS, clientInfoValuesSchema, clientInfoSnapshot, clientInfoChanged, clientInfoDirty, clientInfoSave, reviewClientInfo, resolveClientInfoReview } from "./lib/contacts/client-info";
    let checks = 0;
    function check(name, action) { action(); checks++; console.log("PASS " + name); }
    const old = "2026-10-29T14:00:00.000Z", newer = "2026-10-29T14:01:00.000Z";
    const contact = { id:"synthetic-client", recordSource:"db", updatedAt:old, about:"Original note", personalDetails:[{label:"Reference",value:"Original value"}] };
    const start = () => clientInfoSnapshot(contact);
    const copy = (values) => JSON.parse(JSON.stringify(values));
    check("optional empty information normalizes without invented content", () => assert.deepEqual(clientInfoSnapshot({id:"empty"}).values, {about:"", personalDetails:[]}));
    check("blank rows are omitted and text is trimmed", () => assert.deepEqual(clientInfoValuesSchema.parse({about:" Note ", personalDetails:[{label:" ",value:" "},{label:" Label ",value:" Value "}]}), {about:"Note",personalDetails:[{label:"Label",value:"Value"}]}));
    check("partly completed rows require both fields", () => { for (const row of [{label:"Only label",value:""},{label:"",value:"Only value"}]) assert.equal(clientInfoValuesSchema.safeParse({about:"",personalDetails:[row]}).success,false); });
    check("text limits include exact boundaries", () => { const valid={about:"a".repeat(CLIENT_INFO_LIMITS.about),personalDetails:[{label:"l".repeat(CLIENT_INFO_LIMITS.label),value:"v".repeat(CLIENT_INFO_LIMITS.value)}]}; assert.equal(clientInfoValuesSchema.safeParse(valid).success,true); for (const field of ["about","label","value"]) {const bad=copy(valid); if(field==="about") bad.about+="a"; else bad.personalDetails[0][field]+="x"; assert.equal(clientInfoValuesSchema.safeParse(bad).success,false);} });
    check("at most twenty saved details; blank rows do not consume the limit", () => {const twenty=Array.from({length:20},(_,i)=>({label:"Detail "+i,value:"Value"})); assert.equal(clientInfoValuesSchema.safeParse({about:"",personalDetails:[...twenty,{label:"",value:""}]}).success,true); assert.equal(clientInfoValuesSchema.safeParse({about:"",personalDetails:[...twenty,{label:"Extra",value:"Value"}]}).success,false);});
    check("malformed and unknown detail fields are rejected", () => { for(const row of [{label:2,value:"value"},{label:"label",value:"value",html:true}]) assert.equal(clientInfoValuesSchema.safeParse({about:"",personalDetails:[row]}).success,false); });
    check("opening snapshot copies the saved detail values", () => {const baseline=start(); const mutable={...contact,personalDetails:copy(contact.personalDetails)}; const frozen=clientInfoSnapshot(mutable); mutable.personalDetails[0].value="Changed later"; assert.deepEqual(frozen,baseline);});
    check("blank draft rows do not enable a pointless save", () => {const baseline=start(); assert.equal(clientInfoDirty(baseline,{...baseline.values,personalDetails:[...baseline.values.personalDetails,{label:" ",value:""}]}),false);});
    check("save includes only owned fields and frozen revision", () => {const baseline=start(); const draft={...baseline.values,about:" Draft "}; const patch=clientInfoSave(baseline,draft); assert.deepEqual(patch,{about:"Draft",personalDetails:contact.personalDetails,expectedUpdatedAt:old}); assert.deepEqual(Object.keys(patch).sort(),["about","expectedUpdatedAt","personalDetails"]);});
    check("newer unrelated contact revision still requires explicit review", () => {const baseline=start(); const latest=clientInfoSnapshot({...contact,updatedAt:newer}); assert.equal(clientInfoChanged(baseline,latest),true); const reviewed=reviewClientInfo(baseline,{...baseline.values,about:"My draft"},latest); assert.deepEqual(reviewed.conflicts,[]); assert.equal(reviewed.values.about,"My draft"); assert.equal(clientInfoSave(reviewed.latest,reviewed.values).expectedUpdatedAt,newer);});
    check("newer untouched details merge while the About draft survives", () => {const baseline=start(); const latest=clientInfoSnapshot({...contact,updatedAt:newer,personalDetails:[{label:"Reference",value:"New saved value"}]}); const reviewed=reviewClientInfo(baseline,{...baseline.values,about:"My draft"},latest); assert.deepEqual(reviewed.conflicts,[]); assert.deepEqual(reviewed.values,{about:"My draft",personalDetails:latest.values.personalDetails});});
    check("overlapping sections cannot be resolved without an explicit choice", () => {const baseline=start(); const draft={about:"My draft",personalDetails:[{label:"Draft",value:"Draft value"}]}; const latest=clientInfoSnapshot({...contact,updatedAt:newer,about:"New saved note",personalDetails:[{label:"Saved",value:"Saved value"}]}); const reviewed=reviewClientInfo(baseline,draft,latest); assert.deepEqual(reviewed.conflicts,["about","personalDetails"]); assert.equal(resolveClientInfoReview(reviewed,{}),null); assert.equal(resolveClientInfoReview(reviewed,{about:"mine"}),null); const done=resolveClientInfoReview(reviewed,{about:"mine",personalDetails:"saved"}); assert.deepEqual(done.values,{about:"My draft",personalDetails:latest.values.personalDetails}); assert.equal(done.baseline.expectedUpdatedAt,newer);});
    check("saved deletion and matching concurrent changes remain explicit and safe", () => {const baseline=start(); const same=reviewClientInfo(baseline,{...baseline.values,about:"Same note"},clientInfoSnapshot({...contact,updatedAt:newer,about:"Same note",personalDetails:[]})); assert.deepEqual(same.conflicts,[]); assert.deepEqual(same.values,{about:"Same note",personalDetails:[]});});
    check("an older parent prop does not undo a directly reviewed revision", () => {const reviewed=clientInfoSnapshot({...contact,updatedAt:newer}); assert.equal(clientInfoChanged(reviewed,start()),false); assert.throws(()=>reviewClientInfo(reviewed,reviewed.values,start()),/newer saved version/); assert.throws(()=>reviewClientInfo(start(),start().values,clientInfoSnapshot({...contact,id:"other"})),/does not match/);});
    check("actual read-only UI includes saved content and no write controls", () => {const html=renderToStaticMarkup(React.createElement(ClientInfo,{lead:contact,canWrite:false,onSave:async()=>{throw Error("must never save on render")}})); for(const text of ["About this client","Original note","Reference","Original value"]) assert.ok(html.includes(text)); assert.ok(!html.includes("<button")); assert.ok(!html.includes("<textarea"));});
    check("actual read UI renders labels and values as escaped text", () => {const html=renderToStaticMarkup(React.createElement(ClientInfo,{lead:{...contact,about:"<script>alert(1)</script>",personalDetails:[{label:"<b>Label</b>",value:"<img src=x onerror=alert(1)>"}]},canWrite:false,onSave:async()=>false})); for(const markup of ["<script>","<b>Label</b>","<img src=x"]) assert.ok(!html.includes(markup)); assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("&lt;b&gt;Label&lt;/b&gt;")); assert.ok(html.includes("&lt;img"));});
    check("actual empty UI gives a useful permitted action", () => {const empty={id:"empty",updatedAt:old}; const editable=renderToStaticMarkup(React.createElement(ClientInfo,{lead:empty,canWrite:true,onSave:async()=>false})); assert.ok(editable.includes("No client information added.")); assert.ok(editable.includes("Add information")); assert.ok(editable.includes("Add a short note or named details for your reference.")); const read=renderToStaticMarkup(React.createElement(ClientInfo,{lead:empty,canWrite:false,onSave:async()=>false})); assert.ok(read.includes("No client information added.")); assert.ok(!read.includes("Add information"));});
    console.log(checks + "/" + checks + " client information checks passed");
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false });
  const path = join(temp, "client-info.cjs");
  writeFileSync(path, output.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [path], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Client information checks failed");
} finally { rmSync(temp, { recursive: true, force: true }); }
