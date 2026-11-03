// Actual client adapters exercise immutable vendor generations over the closed synthetic transport.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPreviewTransport } from "./fixtures.mjs";
import { SAMPLE_ACTOR } from "./sample-session.mjs";
import { SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { SAMPLE_FOREIGN_TRANSACTION_ID, sampleTransactionBundles } from "./transaction-fixtures.mjs";
import { samplePropertyCatalog } from "./property-fixtures.mjs";
import { DEFAULT_VENDOR_DETAIL_FIELDS, vendorMonthlyBreakdown } from "../../lib/transactions/vendor-detail-domain.ts";
import { MAX_TRANSACTION_ATTACHMENT_BYTES } from "../../lib/transactions/attachment-format.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)), output = fileURLToPath(new URL(`./dist/gc-transaction-test-${process.pid}.mjs`, import.meta.url));
mkdirSync(path.dirname(output), { recursive: true });
const bundle = await build({ stdin: { contents: 'export * from "./lib/data/adapters/transactions.ts"; export * from "./lib/data/adapters/transaction-workspace.ts"; export * from "./lib/data/adapters/transaction-setup.ts"; export * from "./lib/data/adapters/transaction-property.ts"; export * from "./lib/data/adapters/transaction-tours.ts"; export * from "./lib/data/adapters/saved-showing-tours.ts";', resolveDir: root, sourcefile: "preview-gc-transaction-entry.ts" }, bundle: true, write: false, platform: "node", format: "esm", tsconfigRaw: { compilerOptions: {} }, plugins: [{ name: "actual-gc-transaction-adapters", setup(builder) {
  builder.onResolve({ filter: /^(?:@\/|\.|\/)/ }, args => {
    const base = args.path.startsWith("@/") ? path.join(root, args.path.slice(2)) : path.resolve(args.resolveDir || root, args.path);
    const found = [base, ...[".ts", ".tsx", ".mjs", ".js", "/index.ts"].map(suffix => base + suffix)].find(candidate => existsSync(candidate));
    if (!found) return undefined;
    return found === path.join(root, "lib/data/store.ts") ? { path: pathToFileURL(found).href, external: true } : { path: found };
  });
} }] });
writeFileSync(output, bundle.outputFiles[0].text); let api;
try { api = await import(pathToFileURL(output).href); } finally { rmSync(output, { force: true }); }
globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=interactive&view=%2Ftransactions", origin: "http://127.0.0.1:4173" } });
installPreviewTransport();
const calls = [], responses = [];
globalThis.fetch = async (input, init = {}) => { calls.push({ path: String(input), method: init.method || "GET", body: init.body, headers: init.headers }); const response = await window.fetch(input, init); responses.push({ path: String(input), status: response.status, headers: response.headers }); return response; };
const refused = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const actor = { ...SAMPLE_ACTOR }, baseline = JSON.stringify(sampleTransactionBundles);
const detailInput = record => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: record.transactionUpdatedAt, expectedDetailUpdatedAt: record.updatedAt });
const patch = (record, extra = {}) => ({ ...detailInput(record), details: { ...record.details, ...extra } });
const selection = (file, role, vendor = null, status = "selected") => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: file.updatedAt, role, status, vendorId: vendor?.id ?? null, expectedVendorUpdatedAt: vendor?.updatedAt ?? null, expectedSelectionUpdatedAt: file.vendors.find(row => row.role === role)?.updatedAt ?? null });
const vendorFields = (vendor, extra = {}) => { const { id, updatedAt, ...fields } = vendor; return { ...fields, ...extra }; };
const choose = async (id, role, vendor = null, status = "selected") => { const file = await api.getTransactionWorkspace(id); return api.updateTransactionVendor(id, selection(file, role, vendor, status)); };
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const pdf = new File([pdfBytes], "../../Sample preapproval.html", { type: "text/html" });
let groups=0;
const homeBefore=await(await window.fetch("/api/metrics")).json(),input={requestId:crypto.randomUUID(),side:"gc",address:"123 Sample Contractor Project",clientName:"Sample GC Client"};
const created=await api.createTransaction(input);assert.equal(created.side,"gc");assert.equal(created.transactionType,"general_contractor");assert.equal(created.address,input.address);assert.equal(created.clientName,input.clientName);assert.equal(created.city,"");assert.equal(created.statusLabel,"Setup pending");assert.equal(created.status,"neutral");assert.deepEqual(created.milestones,[]);groups++;
const request=JSON.parse(calls.findLast(c=>c.method==="POST"&&c.path.endsWith("/api/transactions")).body);assert.deepEqual(Object.keys(request).sort(),["addressLine1","clientName","requestId","side","transactionType"].sort());assert.equal(request.transactionType,"general_contractor");groups++;
let file=await api.getTransactionWorkspace(created.id);assert.equal(file.canEdit,false);assert.equal(file.checklist.templateVersion,"gc-blank-v1");assert.deepEqual(file.checklist.items,[]);assert.deepEqual(file.checklist.progress,{completed:0,required:0});assert.deepEqual(file.deadlines,[]);assert.deepEqual(file.vendors,[]);assert.equal(file.parties.length,1);assert.equal(file.parties[0].displayName,input.clientName);assert.equal(file.parties[0].role,"other");groups++;
for(const key of["contractPriceCents","listPriceCents","commissionRateBps","closingDate","contractExecutionDate","mlsNumber","listingKey"])assert.equal(file.details[key],null,key);assert.equal(file.details.city,"");assert.equal(file.details.state,"");assert.equal(file.details.notes,"");groups++;
assert.equal((await api.createTransaction(input)).id,created.id);assert.equal((await api.getTransactionWorkspace(created.id)).history.total,file.history.total);await refused(()=>api.createTransaction({...input,address:"Changed property"}),409,"request_conflict");groups++;
const filtered=await api.getTransactions({side:["gc"]});assert(filtered.some(t=>t.id===created.id));assert(filtered.every(t=>t.side==="gc"));const homeAfter=await(await window.fetch("/api/metrics")).json();assert.deepEqual(homeAfter.transactions.data,homeBefore.transactions.data);assert.deepEqual(homeAfter.leaderboard.data,homeBefore.leaderboard.data);groups++;
const getSource=window.fetch;let lost=true;window.fetch=async(input,init={})=>{const response=await getSource(input,init);if(lost&&init.method==="POST"&&String(input).endsWith("/api/transactions")&&response.ok){lost=false;throw new TypeError("Synthetic lost GC create reply");}return response;};const retryInput={...input,requestId:crypto.randomUUID(),address:"Second Sample GC Project"};await assert.rejects(()=>api.createTransaction(retryInput),TypeError);const recovered=await api.createTransaction(retryInput);window.fetch=getSource;assert.equal((await api.getTransactions({side:["gc"]})).filter(t=>t.address===retryInput.address).length,1);assert.equal(recovered.statusLabel,"Setup pending");groups++;
await refused(()=>api.updateTransactionStage(created.id,"offer",{requestId:crypto.randomUUID(),expectedUpdatedAt:file.updatedAt}),409,"gc_not_configured");await refused(()=>api.lookupTransactionProperty(created.id,{mlsNumber:"SAMPLE-001"}),409,"gc_not_configured");assert.equal((await api.getTransactionProperty(created.id)).canEdit,false);assert.equal((await api.getTransactionTours(created.id)).canEdit,false);assert.equal((await api.getTransactionWorkspace(created.id)).updatedAt,file.updatedAt);groups++;
const linked=await api.createTransaction({...input,requestId:crypto.randomUUID(),contactId:"70000000-0000-4000-8000-000000000001",clientName:"Untrusted override"});assert.notEqual(linked.clientName,"Untrusted override");assert.equal((await api.getTransactionWorkspace(linked.id)).parties[0].canOpenContact,true);groups++;
const bad=await fetch("/api/transactions",{method:"POST",body:JSON.stringify({...request,requestId:crypto.randomUUID(),contractPriceCents:999})});assert.equal(bad.status,400);const readOnlyRole=SAMPLE_ACTOR.role;SAMPLE_ACTOR.role="member";await refused(()=>api.createTransaction({...input,requestId:crypto.randomUUID()}),403,"forbidden");SAMPLE_ACTOR.role=readOnlyRole;groups++;
assert.equal(JSON.stringify(sampleTransactionBundles),baseline);console.log(`PASS: ${groups} isolated GC transaction groups (actual minimal adapter payload, empty workspace/children, exact receipts and lost replies, side filtering, sales write refusal, canonical client and unchanged sales metrics).`);
