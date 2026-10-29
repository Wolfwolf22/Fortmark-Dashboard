/** Client reference information: actual PostgreSQL saves, scope and privacy. */
import assert from "node:assert/strict";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { dashboardUsers } from "../lib/db/schema.ts";
import { createContact, editContact, getContact, listContactsPage, type Ctx } from "../lib/contacts/service.ts";
import { editContactSchema } from "../lib/contacts/domain.ts";
import { contactDetail } from "../lib/ai/tools/dto.ts";

const { pg, db } = await createLocalContactDb();
const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: "22222222-2222-4222-8222-222222222222" };
const ctx: Ctx = { actor, db };
let checks = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); checks++; }
const auditCount = async () => Number((await pg.query<{ n: number }>("select count(*)::int n from audit_events")).rows[0].n);

try {
  await db.insert(dashboardUsers).values([
    { id: actor.userId, clerkUserId: "synthetic_info_owner", primaryEmail: "owner@example.test", status: "active", role: "agent" },
    { id: other.userId, clerkUserId: "synthetic_info_other", primaryEmail: "other@example.test", status: "active", role: "agent" },
  ]);
  const made = await createContact(ctx, { firstName: "Synthetic client", company: "Unchanged company", notes: "Unchanged legacy note" });
  check("new contact has empty optional reference information", made.ok && made.value.about === "" && made.value.personalDetails?.length === 0);
  const id = made.value.id;
  const about = "Private reference token: prefers concise updates. <script>inert</script>";
  const details = [{ label: "Private detail label", value: "Private detail value\nSecond line" }, { label: "Communication preference", value: "Morning calls" }];
  const input = editContactSchema.parse({ expectedUpdatedAt: made.value.updatedAt, about: ` ${about} `, personalDetails: [{ label: " ", value: " " }, ...details] });
  const saved = await editContact(ctx, id, input);
  check("authorized client information saves", saved.ok);
  check("new section reports only its changed fields", saved.value.changed.join() === "about,personalDetails");
  check("text trims and completely blank rows are left out", saved.value.lead.about === about && JSON.stringify(saved.value.lead.personalDetails) === JSON.stringify(details));
  check("unrelated identity, notes and lifecycle are preserved", saved.value.lead.name === "Synthetic client" && saved.value.lead.editable?.company === "Unchanged company" && saved.value.lead.notes === "Unchanged legacy note" && saved.value.lead.stage === "lead");
  check("reference edits do not claim outreach or create reminders", !saved.value.lead.lastTouchDate && !saved.value.lead.nextFollowUpDate);
  const opened = await getContact(ctx, id);
  check("authorized detail read returns persisted information", opened?.about === about && opened.personalDetails?.length === 2);
  const list = await listContactsPage(ctx, { page: 1, pageSize: 25 });
  const listed = list.items.find(row => row.id === id)!;
  check("private information is omitted from the list DTO", !Object.hasOwn(listed, "about") && !Object.hasOwn(listed, "personalDetails"));
  for (const text of ["Private reference token", "Private detail label", "Private detail value", "Morning calls"]) {
    check(`reference information is not contact-search text: ${text}`, (await listContactsPage(ctx, { q: text, page: 1, pageSize: 25 })).total === 0);
    check(`reference information is not sent through the existing AI DTO: ${text}`, !JSON.stringify(contactDetail(opened!)).includes(text));
  }
  const audits = (await pg.query<{ safe_metadata: unknown }>("select safe_metadata from audit_events")).rows;
  check("audit contains field names rather than reference content", audits.some(row => JSON.stringify(row.safe_metadata).includes("personalDetails")) && !JSON.stringify(audits).includes("Private reference token") && !JSON.stringify(audits).includes("Private detail value"));
  const count = await auditCount();
  const noop = await editContact(ctx, id, { expectedUpdatedAt: opened!.updatedAt, about, personalDetails: details });
  check("unchanged information is a real no-op", noop.ok && noop.value.changed.length === 0 && noop.value.lead.updatedAt === opened!.updatedAt && await auditCount() === count);
  const stale = await editContact(ctx, id, { expectedUpdatedAt: made.value.updatedAt, about: "Stale overwrite" });
  check("old reference drafts cannot overwrite the saved version", !stale.ok && stale.reason === "conflict" && (await getContact(ctx, id))?.about === about);
  const reader: Ctx = { actor: { ...actor, role: "member" }, db };
  check("an authorized read-only role can see saved information", (await getContact(reader, id))?.about === about);
  const denied = await editContact(reader, id, { expectedUpdatedAt: opened!.updatedAt, about: "Forbidden" });
  check("read-only roles cannot change reference information", !denied.ok && denied.reason === "forbidden");
  check("another agent cannot read private reference information", await getContact({ actor: other, db }, id) === null);
  check("another brokerage cannot read private reference information", await getContact({ actor: { ...actor, role: "admin", brokerageKey: "elsewhere" }, db }, id) === null);
  const admin: Ctx = { actor: { ...other, role: "admin" }, db };
  check("authorized brokerage admin retains detail visibility", (await getContact(admin, id))?.about === about);

  for (const patch of [
    { about: "a".repeat(2001) },
    { personalDetails: [{ label: "Only label", value: "" }] },
    { personalDetails: [{ label: "", value: "Only value" }] },
    { personalDetails: [{ label: "l".repeat(61), value: "value" }] },
    { personalDetails: [{ label: "label", value: "v".repeat(501) }] },
    { personalDetails: Array.from({ length: 21 }, () => ({ label: "label", value: "value" })) },
    { personalDetails: [{ label: "label", value: "value", html: true }] },
    { about: String.fromCharCode(0) },
    { personalDetails: [{ label: "label", value: String.fromCharCode(0) }] },
  ]) check("invalid client information is rejected at the shared request boundary", !editContactSchema.safeParse({ expectedUpdatedAt: opened!.updatedAt, ...patch }).success);

  // A failure in the audit must roll back new JSON/text fields along with the revision.
  await pg.exec("create function fail_info_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic failure'; end$$; create trigger fail_info before insert on audit_events for each row execute function fail_info_audit()");
  const failed = await editContact(ctx, id, { expectedUpdatedAt: opened!.updatedAt, about: "Must roll back", personalDetails: [] });
  check("reference save reports an audit failure", !failed.ok && failed.reason === "unavailable");
  const afterFailure = await getContact(ctx, id);
  check("failed reference save preserves information and revision", afterFailure?.about === about && afterFailure.updatedAt === opened!.updatedAt && afterFailure.personalDetails?.length === 2);
  await pg.exec("drop trigger fail_info on audit_events; drop function fail_info_audit()");
  const cleared = await editContact(ctx, id, { expectedUpdatedAt: afterFailure!.updatedAt, about: "", personalDetails: [] });
  check("optional information can be explicitly cleared", cleared.ok && cleared.value.lead.about === "" && cleared.value.lead.personalDetails?.length === 0);
  await assert.rejects(pg.query("update contacts set about=$2 where id=$1", [id, "x".repeat(2001)])); checks++;
  await assert.rejects(pg.query("update contacts set personal_details='{}'::jsonb where id=$1", [id])); checks++;
  await assert.rejects(pg.query("update contacts set personal_details=$2::jsonb where id=$1", [id, JSON.stringify(Array.from({ length: 21 }, () => ({})))])); checks++;
  console.log(`${checks}/${checks} client information service checks passed`);
} finally { await pg.close(); }
