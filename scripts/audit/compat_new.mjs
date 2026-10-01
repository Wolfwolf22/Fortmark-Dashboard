// Contacts V3 runtime against a Production-shaped database (legacy rows, schema 0013).
export async function run({ db, ctxA, ctxB, ok, pg, ids, import_ }) {
  const cs = await import_("lib/contacts/service.ts");
  const ns = await import_("lib/contacts/notes-service.ts");
  const ne = await import_("lib/contacts/needs-service.ts");
  const el = await import_("lib/contacts/eligible.ts");
  const lt = await import_("lib/contacts/linked-transactions.ts");
  const ts = await import_("lib/transactions/service.ts");
  const attempt = async (name, fn, test) => {
    try { const v = await fn(); ok(name, test ? test(v) : true, JSON.stringify(v)?.slice(0, 220)); return v; }
    catch (e) { ok(name, false, String(e.message).slice(0, 300)); return null; }
  };
  const q = async (sql, p = []) => (await pg.query(sql, p)).rows;

  // Legacy contact renders; legacy note is a single field, not duplicated into notes
  await attempt("new: admin sees the whole brokerage's contacts", () => cs.listContactsPage(ctxA, {}), (p) => (p.items?.length ?? p.total) === 2);
  await attempt("new: an agent sees only their own book", () => cs.listContactsPage(ctxB, {}), (p) => (p.items?.length ?? p.total) === 1);
  const c1 = await attempt("new: the pre-existing Representation contact renders, birthday not set", () => cs.getContact(ctxA, ids.C1), (c) => c && c.stage === "representation" && c.notes === "An old free-text note" && (c.birthday == null));
  await attempt("new: legacy free-text note is NOT copied into contact_notes", () => ns.listNotes(ctxA, ids.C1), (r) => r.ok && r.value.length === 0);
  await attempt("new: the existing note-kind activity stays a timeline event", () => cs.listActivities(ctxA, ids.C1), (a) => a.length === 3 && a.some((x) => x.kind === "note"));
  await attempt("new: timeline renders legacy history", () => cs.getTimeline(ctxA, ids.C1), (t) => t.ok && t.value.length >= 3);
  await attempt("new: getContactNeeds on a contact with none", () => ne.getContactNeeds(ctxA, ids.C1), (r) => r.ok && r.value.length === 0);
  await attempt("new: linked transactions of a contact with none", () => lt.listLinkedTransactions(ctxA, ids.C1), (r) => r.ok && r.value.length === 0);

  // Transactions with NULL contact_id
  await attempt("new: legacy deals (no contact link) list for admin", () => ts.listTransactions(ctxA, {}), (l) => l.length === 2);
  await attempt("new: a legacy deal with no contact link renders", () => ts.getTransaction(ctxA, ids.T1), (t) => t && t.id === ids.T1);

  // Notes: composer path, tombstone, audit hygiene
  const secret = "Compat private body 7781";
  const n = await attempt("new: add a note", () => ns.addNote(ctxA, ids.C1, { body: secret }), (r) => r.ok);
  if (n?.ok) {
    await attempt("new: delete the note", () => ns.deleteNote(ctxA, ids.C1, n.value.id), (r) => r.ok);
    const row = (await q("select body, deleted_at is not null d from contact_notes where id=$1", [n.value.id]))[0];
    ok("new: a deleted note keeps its row and loses its text", row && row.body === null && row.d === true);
    const leaks = await q("select count(*)::int n from audit_events where safe_metadata::text like '%7781%' or safe_metadata::text like '%Compat private%'");
    ok("new: no audit row carries the note text", leaks[0].n === 0);
  }
  // Needs + audit hygiene
  const need = await attempt("new: create a need", () => ne.createNeed(ctxA, ids.C1, { kind: "buy", areas: ["Zzyzx Heights"], priceMaxCents: 123456700, mustHaves: ["moat"] }), (r) => r.ok);
  const nl = await q("select count(*)::int n from audit_events where safe_metadata::text ilike '%Zzyzx%' or safe_metadata::text like '%123456700%' or safe_metadata::text ilike '%moat%'");
  ok("new: no audit row carries a need's values", nl[0].n === 0);
  // Birthday
  const b = await attempt("new: set a birthday (Feb 29)", () => cs.editContact(ctxA, ids.C1, { birthday: { month: 2, day: 29 } }), (r) => r.ok);
  const bl = await q("select count(*)::int n from audit_events where safe_metadata::text like '%29%' and event_type='contact_updated' and created_at > now() - interval '1 hour' and safe_metadata::text ~ '\"(month|day|birthdayMonth|birthdayDay)\"'");
  ok("new: no audit row carries the birthday's values", bl[0].n === 0);
  await attempt("new: clear the birthday", () => cs.editContact(ctxA, ids.C1, { birthday: null }), (r) => r.ok);

  // Existing Representation contact is not forced through any notice by ordinary edits/touches
  await attempt("new: editing an existing Representation contact needs no acknowledgement", () => cs.editContact(ctxA, ids.C1, { company: "Compat Co" }), (r) => r.ok);

  // Representation -> Transaction
  const el1 = await attempt("new: eligible selector (admin) offers the Representation contact only", () => el.listEligibleContacts(ctxA), (l) => l.length === 1 && l[0].id === ids.C1);
  await attempt("new: eligible selector (agent) offers nothing (their only contact is a lead)", () => el.listEligibleContacts(ctxB), (l) => l.length === 0);
  const linked = await attempt("new: create a deal from the Representation contact", () => ts.createTransaction(ctxA, { transactionType: "residential_sale", side: "buyer", addressLine1: "9 Compat Way", city: "Miami", contactId: ids.C1 }), (r) => r.ok);
  if (linked?.ok) {
    const lk = await q("select contact_id::text c, role::text r, is_primary p from transaction_parties where transaction_id=$1", [linked.value.id]);
    ok("new: the contact is the primary client party via transaction_parties.contact_id", lk.length === 1 && lk[0].c === ids.C1 && lk[0].p === true);
    await attempt("new: the contact now lists the linked deal", () => lt.listLinkedTransactions(ctxA, ids.C1), (r) => r.ok && r.value.length === 1);
  }
  await attempt("new: a contact below Representation is refused", () => ts.createTransaction(ctxA, { transactionType: "residential_sale", side: "buyer", addressLine1: "10 Compat Way", city: "Miami", contactId: ids.C2 }), (r) => !r.ok && r.reason === "invalid_contact");
  await attempt("new: a deal without a contact still works (legacy path)", () => ts.createTransaction(ctxA, { transactionType: "residential_sale", side: "buyer", addressLine1: "11 Compat Way", city: "Miami", parties: [{ role: "buyer", displayName: "Free Text Buyer", isPrimary: true }] }), (r) => r.ok);

  // No automatic changes
  const st = (await q("select stage::text s from contacts where id=$1", [ids.C1]))[0];
  ok("new: the Representation contact is still at Representation (nothing auto-moved)", st.s === "representation");
  const own = await q("select count(*)::int n from contacts where assigned_agent_user_id is distinct from created_by_user_id");
  ok("new: ownership untouched (assigned = creator everywhere)", own[0].n === 0);

  // Home metrics (the real path: Clerk id -> actor -> counts), through the same shim
  {
    const env = { DATABASE_URL: "postgres://shim:shim@db.example.invalid/compat", PROFILE_DATABASE_ENABLED: "1", TRANSACTIONS_DATABASE_ENABLED: "1", CONTACTS_DATABASE_ENABLED: "1" };
    process.env.DATABASE_URL = env.DATABASE_URL;
    const ms = await import_("lib/metrics/service.ts");
    await attempt("new: Home metrics compute from the database", () => ms.brokerageMetrics("user_LEGACY1", { env }), (m) => m && JSON.stringify(m).length > 100);
  }
}
