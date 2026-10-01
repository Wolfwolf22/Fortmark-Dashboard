// Production runtime (74ff9d4) against the 0013 schema, legacy-shaped data.
export async function run({ db, ctxA, ctxB, ok, pg, ids, import_ }) {
  const cs = await import_("lib/contacts/service.ts");
  const ts = await import_("lib/transactions/service.ts");
  const attempt = async (name, fn, test) => {
    try { const v = await fn(); ok(name, test ? test(v) : true, JSON.stringify(v)?.slice(0, 200)); return v; }
    catch (e) { ok(name, false, String(e.message).slice(0, 300)); return null; }
  };

  // Reads
  await attempt("old: contacts page (admin) lists both legacy contacts", () => cs.listContactsPage(ctxA, {}), (p) => p.items?.length === 2 || p.total === 2);
  await attempt("old: contacts list (agent) is the agent's own", () => cs.listContacts(ctxB, {}), (l) => l.length === 1);
  await attempt("old: snapshot", () => cs.contactSnapshot(ctxA), (s) => typeof s === "object");
  const c1 = await attempt("old: one contact renders with its legacy note", () => cs.getContact(ctxA, ids.C1), (c) => c && c.notes === "An old free-text note" && c.stage === "representation");
  await attempt("old: activities of a contact", () => cs.listActivities(ctxA, ids.C1), (a) => a.length === 3);
  await attempt("old: timeline", () => cs.getTimeline(ctxA, ids.C1), (t) => t.ok && t.value.length >= 3);

  // Writes (the old runtime never sets the new columns; the new CHECKs must not trip)
  const made = await attempt("old: create a contact", () => cs.createContact(ctxA, { firstName: "Compat", lastName: "Created", source: "website", intent: "buying" }), (r) => r.ok);
  await attempt("old: edit a contact", () => cs.editContact(ctxA, ids.C2, { firstName: "Edited", notes: "edited by the old runtime" }), (r) => r.ok);
  await attempt("old: change a contact's stage", () => cs.changeStage(ctxA, ids.C2, "contacted"), (r) => r.ok);
  await attempt("old: log a touch", () => cs.logActivity(ctxA, ids.C2, { kind: "call", summary: "Called back" }), (r) => r.ok);
  await attempt("old: set a follow-up", () => cs.changeFollowUp(ctxA, ids.C2, { action: "set", day: "2030-01-15" }), (r) => r.ok);
  await attempt("old: reassign (a route that exists only in the old runtime)", () => cs.reassignContact(ctxA, ids.C2, ids.U2), (r) => r.ok);

  // Transactions
  await attempt("old: transactions list (admin) shows both legacy deals", () => ts.listTransactions(ctxA, {}), (l) => l.length >= 2);
  await attempt("old: a legacy deal with no contact link renders", () => ts.getTransaction(ctxA, ids.T1), (t) => t && t.id === ids.T1);
  const created = await attempt("old: create a transaction", () => ts.createTransaction(ctxA, { transactionType: "residential_sale", side: "buyer", addressLine1: "9 Compat Way", city: "Miami", parties: [{ role: "buyer", displayName: "Compat Buyer", isPrimary: true }] }), (r) => r.ok);
  if (created?.ok) await attempt("old: change a transaction's stage", () => ts.changeStage(ctxA, created.value.id, "offer"), (r) => r.ok);

  // Search and metrics (when callable from here)
  try {
    const ss = await import_("lib/search/service.ts");
    await attempt("old: global search finds a legacy contact by name", () => ss.search({ actor: ctxA.actor, db }, "Legacy"), (r) => JSON.stringify(r).includes("Legacy"));
  } catch (e) { ok("old: global search callable", false, String(e.message).slice(0, 200)); }

  // The V3 tables are inert to the old runtime
  const inert = (await pg.query("select (select count(*)::int from contact_notes) n, (select count(*)::int from contact_needs) d, (select count(*)::int from contacts where birthday_month is not null or birthday_day is not null) b")).rows[0];
  ok("old runtime leaves the V3 tables and columns empty", inert.n === 0 && inert.d === 0 && inert.b === 0);
  const audit = (await pg.query("select count(*)::int n from audit_events where event_type like 'contact_%'")).rows[0];
  ok("old runtime audit rows are written (event_type is text, not an enum)", audit.n >= 1);

  // Home metrics (the real path: Clerk id -> actor -> counts), through the same shim
  {
    const env = { DATABASE_URL: "postgres://shim:shim@db.example.invalid/compat", PROFILE_DATABASE_ENABLED: "1", TRANSACTIONS_DATABASE_ENABLED: "1", CONTACTS_DATABASE_ENABLED: "1" };
    process.env.DATABASE_URL = env.DATABASE_URL;
    const ms = await import_("lib/metrics/service.ts");
    await attempt("old: Home metrics compute from the database", () => ms.brokerageMetrics("user_LEGACY1", { env }), (m) => m && JSON.stringify(m).length > 100);
  }
}
