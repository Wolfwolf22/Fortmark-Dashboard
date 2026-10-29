/** Exercise the actual browser adapter with synthetic responses; no network. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "fortmark-stage-adapter-"));
try {
  const entry = `
    import assert from "node:assert/strict";
    import { updateLeadStage, LeadsError } from "./lib/data/adapters/leads.ts";
    import { useDataVersion } from "./lib/data/store.ts";
    let checks = 0, mode = "lost";
    const writes = [];
    function check(name, condition) { assert.ok(condition, name); checks++; }
    const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers:{"Content-Type":"application/json"}});
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/api/contacts/source")) return json({source:"db"});
      writes.push({path:String(path), ...init});
      if (mode === "lost") throw new TypeError("Synthetic lost response");
      if (mode === "conflict") return json({error:"conflict"},409);
      return json({contact:{id:"synthetic",stage:"representation"}});
    };
    async function main() {
      let version = useDataVersion.getState().version;
      await assert.rejects(updateLeadStage("synthetic","qualified",{expectedStage:"lead"}),TypeError); checks++;
      check("a lost stage response revalidates every shared read",useDataVersion.getState().version === version+1);
      check("a failed stage write is never retried",writes.length === 1 && writes[0].method === "POST");
      check("stage requests carry their observed source without claiming outreach",JSON.stringify(JSON.parse(writes[0].body)) === JSON.stringify({stage:"qualified",expectedStage:"lead"}));
      mode = "conflict"; version = useDataVersion.getState().version;
      await assert.rejects(updateLeadStage("synthetic","lead",{expectedStage:"archived"}),error=>error instanceof LeadsError && error.status===409 && error.code==="conflict"); checks++;
      check("a stale refusal also revalidates shared surfaces without retry",useDataVersion.getState().version===version+1 && writes.length===2);
      mode = "success"; version = useDataVersion.getState().version;
      const contact = await updateLeadStage("synthetic","representation",{expectedStage:"qualified",engagementAcknowledged:true});
      check("a successful response returns the saved stage",contact.stage === "representation");
      check("a successful stage request revalidates once",useDataVersion.getState().version===version+1 && writes.length===3);
      check("the engagement decision is passed through as recorded",JSON.parse(writes[2].body).engagementAcknowledged===true);
      console.log(checks+"/"+checks+" stage adapter checks passed");
    }
    main().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false });
  const path = join(temp, "stage-adapter.cjs");
  writeFileSync(path, output.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [path], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Stage adapter checks failed");
} finally { rmSync(temp, { recursive: true, force: true }); }
