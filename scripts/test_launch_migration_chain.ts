/** Pending-launch migration rehearsal using actual PostgreSQL in memory. Never uses live credentials. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { assertTransactionSafe } from "./migrate-core.mjs";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const folder = new URL("../lib/db/migrations/", import.meta.url), journal = JSON.parse(readFileSync(new URL("meta/_journal.json", folder), "utf8")) as { entries: { idx: number; when: number; tag: string }[] };
const migration = (tag: string) => readFileSync(new URL(`${tag}.sql`, folder), "utf8");
check("all31journalentriesaretransactioncompatible", assertTransactionSafe(new URL("../lib/db/migrations/", import.meta.url).pathname) === 31);
check("journalindicesandtimestampsarestrictlyordered", journal.entries.every((e, i, rows) => e.idx === i && (i === 0 || e.when > rows[i - 1].when)) && new Set(journal.entries.map(e => e.tag)).size === journal.entries.length);
const pg = new PGlite();
async function apply(from: number, to: number) { for (const entry of journal.entries.slice(from, to + 1)) await pg.exec(migration(entry.tag)); }
async function rows(table: string) { return (await pg.query<Record<string, unknown>>(`select * from ${table} order by id`)).rows; }
const preservedTables = ["dashboard_users", "contacts", "contact_notes", "contact_needs", "contact_opportunities", "contact_activities", "transactions", "transaction_parties", "transaction_deadlines", "transaction_events", "audit_events"] as const;
try {
  await apply(0, 14);
  const owner = randomUUID(), contact = randomUUID(), file = randomUUID();
  await pg.query("insert into dashboard_users(id,clerk_user_id,primary_email,role,status)values($1,'launch-rehearsal','launch-rehearsal@example.test','agent','active')", [owner]);
  await pg.query("insert into contacts(id,assigned_agent_user_id,first_name,email,stage,notes,last_contact_at,next_follow_up_at)values($1,$2,'Existing private client','launch-client@example.test','representation','Existing private contact context','2026-10-01T18:00Z','2026-11-09T12:00Z')", [contact, owner]);
  await pg.query("insert into contact_notes(contact_id,author_user_id,body)values($1,$2,'Existing private narrative')", [contact, owner]);
  await pg.query("insert into contact_needs(contact_id,kind,status,financing,property_types,additional_requirements)values($1,'other','active','other',ARRAY['other'],'Legacy Other description')", [contact]);
  await pg.query("insert into transactions(id,agent_user_id,side,transaction_type,stage,address_line1,city,contract_price_cents,commission_rate_bps,contract_execution_date,closing_date,notes)values($1,$2,'buyer','residential_sale','under_contract','Existing entered address','Existing city',42000000,250,'2026-10-02','2026-11-10','Existing private file notes')", [file, owner]);
  await pg.query("insert into transaction_parties(transaction_id,contact_id,role,display_name,is_primary)values($1,$2,'buyer','Existing private client',true)", [file, contact]);
  await pg.query("insert into transaction_deadlines(transaction_id,kind,label,due_date,completed_at,note)values($1,'inspection','Existing completed inspection','2026-10-08','2026-10-07T16:00Z','Existing deadline note'),($1,'closing','Closing','2026-11-10',null,'Existing closing note')", [file]);
  await pg.query("insert into contact_opportunities(contact_id,kind,status,transaction_id,area,budget_max_cents,notes)values($1,'buyer','open',$2,'Existing area',45000000,'Existing opportunity notes')", [contact, file]);
  await pg.query("insert into contact_activities(contact_id,actor_user_id,kind,summary)values($1,$2,'call','Existing recorded call')", [contact, owner]);
  await pg.query("insert into transaction_events(transaction_id,actor_user_id,event_type,safe_metadata)values($1,$2,'transaction_created','{}')", [file, owner]);
  await pg.query("insert into personal_workspaces(owner_user_id,namespace,data,revision)values($1,'dashboard-layout','{\"existing\":true}',7)", [owner]);
  const before = new Map(await Promise.all(preservedTables.map(async table => [table, await rows(table)] as const))), beforeWorkspace = (await pg.query("select * from personal_workspaces")).rows;
  let rolledBack = false;
  try { await pg.transaction(async tx => { for (const entry of journal.entries.slice(15)) await tx.exec(migration(entry.tag)); throw Error("Synthetic final-step refusal"); }); } catch { rolledBack = true; }
  check("latefailureundoesENTIRE0015through0030DDLbatch", rolledBack && (await pg.query<{ t: string | null }>("select to_regclass('public.calendar_labels')::text as t")).rows[0].t === null && (await pg.query<{ t: string | null }>("select to_regclass('public.contact_create_requests')::text as t")).rows[0].t === null);
  for (const table of preservedTables) check("failedbatchpreservesoriginalrows", JSON.stringify(await rows(table)) === JSON.stringify(before.get(table)));
  await pg.transaction(async tx => { for (const entry of journal.entries.slice(15)) await tx.exec(migration(entry.tag)); });
  for (const table of preservedTables) { const prior = before.get(table)!; const after = await rows(table); check("successfulpendingchainpreserveseveryexistingcolumn", JSON.stringify(after.map(row => Object.fromEntries(Object.keys(prior[0] ?? {}).map(k => [k, row[k]])))) === JSON.stringify(prior)); }
  check("pendingchainpreservespersonalworkspaceandrevision", JSON.stringify((await pg.query("select * from personal_workspaces")).rows) === JSON.stringify(beforeWorkspace));
  check("existingfilesreceive12pendingoperationalitemswithoutfakecompletion", (await pg.query<{ n: number; pending: number }>("select count(*)::int n,count(*)filter(where completed_at is null)::int pending from transaction_checklist_items where transaction_id=$1", [file])).rows.every(row => row.n === 12 && row.pending === 12));
  check("legacyOtherneedsremainreadablewithoutinventedcustomtext", (await pg.query<{ kind_other: string | null; financing_other: string | null; property_type_other: string | null }>("select kind_other,financing_other,property_type_other from contact_needs")).rows.every(row => row.kind_other === null && row.financing_other === null && row.property_type_other === null));
  check("labeldefaultsremainvirtualandmigrationcreatesnopersonalitems", (await pg.query("select * from calendar_labels")).rows.length === 0 && (await pg.query("select * from personal_calendar_items")).rows.length === 0);
} finally { await pg.close(); }

// Exercise the vendor-generation boundary with actual pre-0027 selected vendors/files.
const vendorDb = new PGlite();
try {
  for (const entry of journal.entries.slice(0, 27)) await vendorDb.exec(migration(entry.tag));
  const owner = randomUUID(), file = randomUUID(), vendor = randomUUID(), selected = randomUUID(), unset = randomUUID(), proof = randomUUID();
  await vendorDb.query("insert into dashboard_users(id,clerk_user_id,primary_email,role,status)values($1,'launch-vendor-upgrade','launch-vendor@example.test','agent','active')", [owner]);
  await vendorDb.query("insert into transactions(id,agent_user_id,side,transaction_type,address_line1,city)values($1,$2,'listing','residential_sale','Existing file','Existing city')", [file, owner]);
  await vendorDb.query("insert into brokerage_vendors(id,brokerage_key,name,categories,approved)values($1,'fortmark','Existing selected firm',ARRAY['inspector','mortgage'],true)", [vendor]);
  await vendorDb.query("insert into transaction_vendor_selections(id,transaction_id,role,status,vendor_id,vendor_name,company,email,phone,created_at,updated_at)values($1,$2,'inspector','selected',$3,'Existing selected firm','Existing company','existing@example.test','555-0100','2026-10-01T15:00Z','2026-10-02T15:00Z'),($4,$2,'mortgage','not_needed',null,null,null,null,null,'2026-10-01T15:00Z','2026-10-02T15:00Z')", [selected, file, vendor, unset]);
  await vendorDb.query("insert into transaction_checklist_attachments(id,transaction_id,checklist_item_id,storage_path,filename,content_type,size_bytes,sha256)select $1,$2,id,$3,'Existing private proof.pdf','application/pdf',128,repeat('a',64)from transaction_checklist_items where transaction_id=$2 order by sort_order limit 1", [proof, file, `transaction-files/${file}/${randomUUID()}.pdf`]);
  const selectionsBefore = (await vendorDb.query<Record<string, unknown>>("select * from transaction_vendor_selections order by id")).rows, filesBefore = (await vendorDb.query("select * from transaction_checklist_attachments order by id")).rows;
  await vendorDb.transaction(async tx => { for (const entry of journal.entries.slice(27)) await tx.exec(migration(entry.tag)); });
  const selectionsAfter = (await vendorDb.query<Record<string, unknown>>("select * from transaction_vendor_selections order by id")).rows;
  check("0027retainsallselectionvaluesandsnapshottimes", JSON.stringify(selectionsAfter.map(row => Object.fromEntries(Object.keys(selectionsBefore[0]).map(k => [k, row[k]])))) === JSON.stringify(selectionsBefore));
  const generations = (await vendorDb.query<{ id: string; role: string; vendor_id: string; created_at: string; updated_at: string; details: { notes: string } }>("select * from transaction_vendor_engagements")).rows;
  check("selectedvendorbackfillsoneblankcorrectgeneration", generations.length === 1 && generations[0].role === "inspector" && generations[0].vendor_id === vendor && generations[0].details.notes === "" && selectionsAfter.find(row => row.id === selected)?.detail_id === generations[0].id && selectionsAfter.find(row => row.id === unset)?.detail_id === null);
  check("existingprivateproofreferencesandbytesmetadataunchanged", JSON.stringify((await vendorDb.query("select * from transaction_checklist_attachments order by id")).rows) === JSON.stringify(filesBefore));
  check("upgradesinventnovendorreportsoutreachorprivatehistory", (await vendorDb.query("select * from transaction_vendor_attachments")).rows.length === 0 && (await vendorDb.query("select * from transaction_events")).rows.length === 0 && (await vendorDb.query("select * from contact_activities")).rows.length === 0);
} finally { await vendorDb.close(); }
console.log(`${passed}/${passed} launch migration chain checks passed (atomic0015–0030 rehearsal + vendor backfill; isolated PostgreSQL only)`);
