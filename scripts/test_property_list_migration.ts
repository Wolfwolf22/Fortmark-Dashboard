/** Upgrade existing 0019 saved references in isolated PostgreSQL. No live database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const pg = new PGlite();
const folder = new URL("../lib/db/migrations/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", folder), "utf8")) as { entries: { tag: string }[] };
try {
  const upgrade = journal.entries.find(entry => entry.tag.startsWith("0020_"));
  check("named-list migration is registered", upgrade);
  for (const entry of journal.entries) {
    if (entry === upgrade) break;
    await pg.exec(readFileSync(new URL(`${entry.tag}.sql`, folder), "utf8"));
  }
  const owner = randomUUID(), author = randomUUID(), firstContact = randomUUID(), secondContact = randomUUID();
  await pg.query("insert into dashboard_users(id,clerk_user_id,primary_email,role,status) values ($1,'synthetic_upgrade_owner','owner@example.test','agent','active'),($2,'synthetic_upgrade_author','author@example.test','admin','active')", [owner, author]);
  await pg.query("insert into contacts(id,assigned_agent_user_id,first_name,source,stage) values ($1,$3,'Synthetic first','website','qualified'),($2,$3,'Synthetic second','referral','contacted')", [firstContact, secondContact, owner]);
  const common = { created: "2026-08-01T12:00:00.000Z", removed: "2026-09-01T12:00:00.000Z" };
  for (const [contact, key, number, removed] of [[firstContact, "common-key", "A00123", null], [firstContact, "removed-key", "F00123", common.removed], [secondContact, "common-key", "A00123", null]] as const) {
    await pg.query("insert into contact_properties(id,contact_id,dataset,listing_id,mls_number,created_by_user_id,created_at,removed_at) values($1,$2,'synthetic',$3,$4,$5,$6,$7)", [randomUUID(),contact,key,number,author,common.created,removed]);
  }
  const before = await pg.query("select id,contact_id,dataset,listing_id,mls_number,created_by_user_id,created_at,removed_at from contact_properties order by id");
  await pg.exec(readFileSync(new URL(`${upgrade.tag}.sql`, folder), "utf8"));
  const after = await pg.query("select id,contact_id,dataset,listing_id,mls_number,created_by_user_id,created_at,removed_at from contact_properties order by id");
  check("upgrade preserves every original reference, author, time and removal state", JSON.stringify(before.rows) === JSON.stringify(after.rows));
  const lists = await pg.query<{ id: string; owner_user_id: string; contact_id: string; name: string; default_for_contact_id: string }>("select id,owner_user_id,contact_id,name,default_for_contact_id from property_lists order by contact_id");
  check("existing contacts receive separate named default lists", lists.rows.length === 2 && lists.rows.every(row => row.name.trim() && row.owner_user_id === owner && row.default_for_contact_id === row.contact_id));
  const membership = await pg.query<{ list_id: string; contact_id: string }>("select list_id,contact_id from contact_properties");
  check("all old properties belong to their own contact's migrated list", membership.rows.length === 3 && membership.rows.every(row => lists.rows.some(list => list.id === row.list_id && list.contact_id === row.contact_id)));
  check("same MLS property on different contacts survives migration", (await pg.query("select id from contact_properties where listing_id='common-key' and removed_at is null")).rows.length === 2);
  check("no MLS snapshot fields were introduced by the upgrade", !(await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='contact_properties'")).rows.some(row => /address|price|photo|listing_snapshot/.test(row.column_name)));
  const personal = randomUUID();
  await pg.query("insert into property_lists(id,owner_user_id,brokerage_key,name) values($1,$2,'fortmark','Personal research')", [personal, owner]);
  await pg.query("insert into contact_properties(list_id,contact_id,dataset,listing_id,mls_number,created_by_user_id) values($1,null,'synthetic','common-key','A00123',$2)", [personal, owner]);
  check("same property can also be saved independently in a personal list", (await pg.query("select id from contact_properties where list_id=$1 and contact_id is null", [personal])).rows.length === 1);
  let duplicateRefused = false;
  try { await pg.query("insert into contact_properties(list_id,contact_id,dataset,listing_id,mls_number) values($1,null,'synthetic','common-key','A00123')", [personal]); } catch { duplicateRefused = true; }
  check("the same list still refuses duplicate live property membership", duplicateRefused);
  check("upgrade does not create fake outreach or contact activity", (await pg.query("select id from contact_activities")).rows.length === 0);
  console.log(`${passed}/${passed} property list migration checks passed (isolated PostgreSQL; no live access)`);
} finally { await pg.close(); }
