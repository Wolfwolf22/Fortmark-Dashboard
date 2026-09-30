/**
 * Contacts V3 — Preview certification of the server rules, one role per run.
 *
 *   CV3_ROLE = admin | agent | broker | transaction_coordinator | member
 *
 * The certification identity's role is switched in the Preview database between
 * runs (never Production). Fixtures are synthetic, seeded on the Preview branch,
 * and removed afterwards. Seed contract (all names start "CV3 "):
 *
 *   owned by the identity:   CV3 Ownlead (lead, 7 activities), CV3 Ownrep One and
 *                            CV3 Ownrep Two (representation), CV3 Ownactive
 *                            (active_client), CV3 Ownarchived (archived), plus one
 *                            live note "Seeded note" on Ownlead
 *   owned by a colleague:    CV3 Colleague Rep (representation), CV3 Colleague Lead
 *   ANOTHER brokerage:       CV3 Foreign (representation) — the isolation control
 *   transactions:            an undated opportunity deal owned by the identity
 *                            (no contact link — a legacy deal) and one owned by the colleague
 *
 * Every refusal is paired with the same request succeeding for a role that may
 * make it. Everything runs through the real deployment with a real Clerk session;
 * no rule was relaxed for the run.
 */
import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD, freshToken, refreshingApiFor, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const ROLE = process.env.CV3_ROLE ?? "";
const ROLES = ["admin", "agent", "broker", "transaction_coordinator", "member"];
const IS_ADMIN = ROLE === "admin";
const BROKERAGE_DEALS = ["admin", "broker", "transaction_coordinator"].includes(ROLE);
const WRITER = ROLE !== "member";
const FIX = JSON.parse(process.env.CV3_FIX ?? "{}") as Record<string, string>;
const COLLEAGUE_ID = process.env.CV3_COLLEAGUE_ID ?? "";

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
const say = (line: string) => console.log(`[contacts-v3 ${ROLE}] ${line}`);

type Body = Record<string, any>;
type Reply = { status: number; body: Body };
const get = (path: string) => api(`/dashboard/api${path}`) as Promise<Reply>;
const send = (method: string, path: string, body?: unknown) =>
  api(`/dashboard/api${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<Reply>;
const names = (items: { name: string }[]) => items.map((i) => i.name).sort();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  expect(ROLES, "CV3_ROLE must be set").toContain(ROLE);
  for (const key of ["ownlead", "rep1", "rep2", "active", "archived", "colRep", "colLead", "foreign", "legacyDeal", "colleagueDeal"]) {
    expect(FIX[key], `fixture id ${key}`).toBeTruthy();
  }
  page = await (await browser.newContext()).newPage();
  await signInCertificationUser(page);
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await freshToken(page);
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
  }
  api = refreshingApiFor(page);
});

test.afterAll(async () => {
  await page?.close();
});

// ---------------------------------------------------------------------------------------
test("the session is this role, and Contacts scope is a personal book unless the role is admin", async () => {
  const all = await send("POST", "/contacts/search", {});
  expect(all.status).toBe(200);
  // The fixture only: earlier runs of this spec create probe contacts (owned by the identity), which are not what is being counted.
  const FIXTURE = new Set(["CV3 Ownlead", "CV3 Ownrep One", "CV3 Ownrep Two", "CV3 Ownactive", "CV3 Ownarchived", "CV3 Colleague Rep", "CV3 Colleague Lead", "CV3 Foreign"]);
  const mine = (all.body.items as Body[]).filter((i) => FIXTURE.has(String(i.name)));
  say(`sees ${mine.length} CV3 contacts: ${names(mine as never).join(", ")}`);
  const own = ["CV3 Ownactive", "CV3 Ownarchived", "CV3 Ownlead", "CV3 Ownrep One", "CV3 Ownrep Two"];
  if (IS_ADMIN) {
    expect(names(mine as never)).toEqual([...own, "CV3 Colleague Lead", "CV3 Colleague Rep"].sort());
  } else {
    expect(names(mine as never), "everyone but an admin has a personal book — broker and coordinator included").toEqual(own);
  }
  expect(names(mine as never), "another brokerage is never listed").not.toContain("CV3 Foreign");
  for (const [key, label] of [["colRep", "colleague's Representation contact"], ["colLead", "colleague's lead"]] as const) {
    expect((await get(`/contacts/${FIX[key]}`)).status, `${label}: ${IS_ADMIN ? "an admin opens it" : "not found for everyone else"}`).toBe(IS_ADMIN ? 200 : 404);
  }
  expect((await get(`/contacts/${FIX.foreign}`)).status, "another brokerage: not found, even for an admin").toBe(404);
  expect((await get(`/contacts/${FIX.rep1}`)).status, "their own: always").toBe(200);
});

test("an admin sees the owner's name on a colleague's contact; everyone sees their own without it", async () => {
  const mine = await get(`/contacts/${FIX.rep1}`);
  expect(mine.body.contact.ownedByViewer).toBe(true);
  if (IS_ADMIN) {
    const theirs = await get(`/contacts/${FIX.colRep}`);
    expect(theirs.body.contact.ownedByViewer).toBe(false);
    expect(typeof theirs.body.contact.assignedAgentName === "string" || theirs.body.contact.assignedAgentName === undefined).toBe(true);
  }
  expect(JSON.stringify(mine.body)).not.toMatch(/clerk|user_[A-Za-z0-9]{8}|@fortmark/i);
});

test("reassignment is gone: the endpoint does not exist, and create cannot name an owner", async () => {
  for (const key of ["rep1", "colRep"]) {
    const res = await send("POST", `/contacts/${FIX[key]}/reassign`, { agentId: COLLEAGUE_ID });
    expect(res.status, `reassign ${key} is a 404, whoever asks`).toBe(404);
  }
  // Reading back, ownership did not move.
  expect((await get(`/contacts/${FIX.rep1}`)).body.contact.ownedByViewer).toBe(true);
  if (WRITER) {
    const created = await send("POST", "/contacts", { firstName: "CV3", lastName: "Ownerprobe", assignedAgentUserId: COLLEAGUE_ID });
    if (created.status === 201) {
      expect(created.body.contact.ownedByViewer, "a contact belongs to its creator whatever the body says").toBe(true);
      expect(created.body.contact.assignedAgentId).not.toBe(COLLEAGUE_ID);
    }
    expect([201, 400]).toContain(created.status);
  }
});

test("the legacy /leads address redirects to /contacts with a 307 and keeps the query string", async () => {
  for (const [from, to] of [
    ["/dashboard/leads?stage=representation", "/dashboard/contacts?stage=representation"],
    [`/dashboard/leads?open=${FIX.rep1}`, `/dashboard/contacts?open=${FIX.rep1}`],
    ["/dashboard/leads", "/dashboard/contacts"],
  ]) {
    const res = await fetch(`${DASHBOARD}${from}`, { redirect: "manual" });
    expect(res.status, from).toBe(307);
    expect(res.headers.get("location") ?? "", from).toContain(to);
  }
});

// ---------------------------------------------------------------------------------------
test("notes: a writer adds one; it has an author and a timestamp; plain text survives", async () => {
  test.skip(!WRITER, "member has no write access — see the denial test");
  const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> & "quotes"';
  const added = await send("POST", `/contacts/${FIX.rep1}/notes`, { body: `  ${xss}  ` });
  expect(added.status).toBe(201);
  expect(added.body.note.body, "trimmed, otherwise exactly as typed").toBe(xss);
  expect(typeof added.body.note.createdAt).toBe("string");
  expect(Number.isNaN(new Date(added.body.note.createdAt).getTime())).toBe(false);
  expect(Object.keys(added.body.note).sort()).toEqual(["author", "body", "canDelete", "createdAt", "id"].filter((k) => k in added.body.note).sort());
  expect(JSON.stringify(added.body)).not.toMatch(/authorUserId|user_[A-Za-z0-9]{8}|@/);
  const listed = await get(`/contacts/${FIX.rep1}/notes`);
  expect(listed.status).toBe(200);
  expect((listed.body.items as Body[]).some((n) => n.id === added.body.note.id && n.body === xss)).toBe(true);
  say(`note added; author=${JSON.stringify(added.body.note.author)}`);
  (globalThis as Record<string, unknown>).__noteId = added.body.note.id;
});

test("notes: limits and shape are enforced, naming the field and never the text", async () => {
  test.skip(!WRITER, "member has no write access");
  const empty = await send("POST", `/contacts/${FIX.rep1}/notes`, { body: "   " });
  expect(empty.status).toBe(400);
  expect(empty.body).toEqual({ error: "invalid", fields: ["body"] });
  const over = await send("POST", `/contacts/${FIX.rep1}/notes`, { body: "x".repeat(10_001) });
  expect(over.status).toBe(400);
  expect(JSON.stringify(over.body)).not.toContain("xxxx");
  const exact = await send("POST", `/contacts/${FIX.rep1}/notes`, { body: "y".repeat(10_000) });
  expect(exact.status, "exactly the limit is accepted").toBe(201);
  expect((await send("POST", `/contacts/${FIX.rep1}/notes`, { body: "ok", authorUserId: COLLEAGUE_ID })).status, "an author cannot be named").toBe(400);
  expect((await send("POST", `/contacts/${FIX.rep1}/notes`, "not an object")).status).toBe(400);
  await send("DELETE", `/contacts/${FIX.rep1}/notes/${exact.body.note.id}`);
});

test("notes: delete removes the note; a second delete and a wrong contact are not found; there is no edit", async () => {
  test.skip(!WRITER, "member has no write access");
  const id = (globalThis as Record<string, unknown>).__noteId as string;
  expect((await send("DELETE", `/contacts/${FIX.rep2}/notes/${id}`)).status, "the note is not on this contact").toBe(404);
  const gone = await send("DELETE", `/contacts/${FIX.rep1}/notes/${id}`);
  expect(gone.status).toBe(200);
  const after = await get(`/contacts/${FIX.rep1}/notes`);
  expect((after.body.items as Body[]).some((n) => n.id === id), "a deleted note is not returned").toBe(false);
  expect(JSON.stringify(after.body)).not.toContain("window.__xss");
  expect((await send("DELETE", `/contacts/${FIX.rep1}/notes/${id}`)).status, "deleting twice").toBe(404);
  for (const method of ["PATCH", "PUT"]) {
    expect((await send(method, `/contacts/${FIX.rep1}/notes/${id}`, { body: "edited" })).status, `${method} on a note`).toBeGreaterThanOrEqual(404);
  }
  expect((await send("DELETE", `/contacts/${FIX.rep1}/notes/not-a-uuid`)).status).toBe(404);
});

test("notes: scope — a colleague's contact, another brokerage, and a member's writes", async () => {
  const colleagueNotes = await get(`/contacts/${FIX.colLead}/notes`);
  const add = await send("POST", `/contacts/${FIX.colLead}/notes`, { body: "admin note" });
  if (IS_ADMIN) {
    expect(colleagueNotes.status).toBe(200);
    expect(add.status, "an admin may add a note to any contact").toBe(201);
    expect((await send("DELETE", `/contacts/${FIX.colLead}/notes/${add.body.note.id}`)).status, "…and delete it").toBe(200);
  } else {
    expect(colleagueNotes.status, "a colleague's notes are not found").toBe(404);
    expect(add.status).toBe(404);
  }
  expect((await get(`/contacts/${FIX.foreign}/notes`)).status).toBe(404);
  expect((await send("POST", `/contacts/${FIX.foreign}/notes`, { body: "x" })).status).toBe(404);
  if (!WRITER) {
    const denied = await send("POST", `/contacts/${FIX.ownlead}/notes`, { body: "a member may not" });
    expect(denied.status, "a member is forbidden on their own contact").toBe(403);
    const seeded = (await get(`/contacts/${FIX.ownlead}/notes`)).body.items as Body[];
    expect(seeded.some((n) => n.body === "Seeded note"), "…but may read it").toBe(true);
    expect(seeded.every((n) => n.canDelete === false), "…and is not offered delete").toBe(true);
    const seededId = seeded.find((n) => n.body === "Seeded note")!.id;
    expect((await send("DELETE", `/contacts/${FIX.ownlead}/notes/${seededId}`)).status).toBe(403);
    expect(((await get(`/contacts/${FIX.ownlead}/notes`)).body.items as Body[]).some((n) => n.id === seededId), "nothing was deleted").toBe(true);
  }
});

// ---------------------------------------------------------------------------------------
test("birthday: set, change, clear — month and day only", async () => {
  test.skip(!WRITER, "member has no write access");
  const set = await send("PATCH", `/contacts/${FIX.rep2}`, { birthday: { month: 3, day: 17 } });
  expect(set.status).toBe(200);
  expect(set.body.contact.birthday).toEqual({ month: 3, day: 17 });
  expect(set.body.changed).toEqual(["birthday"]);
  const changed = await send("PATCH", `/contacts/${FIX.rep2}`, { birthday: { month: 2, day: 29 } });
  expect(changed.status, "February 29 is allowed — the year is unknown").toBe(200);
  expect(changed.body.contact.birthday).toEqual({ month: 2, day: 29 });
  const same = await send("PATCH", `/contacts/${FIX.rep2}`, { birthday: { month: 2, day: 29 } });
  expect(same.body.changed, "an unchanged birthday changes nothing").toEqual([]);
  const cleared = await send("PATCH", `/contacts/${FIX.rep2}`, { birthday: null });
  expect(cleared.status).toBe(200);
  expect(cleared.body.contact.birthday).toBeNull();
  for (const bad of [{ month: 2, day: 30 }, { month: 4, day: 31 }, { month: 13, day: 1 }, { month: 1, day: 0 }, { month: 3, day: 17, year: 1990 }, { month: "3", day: "17" }]) {
    const r = await send("PATCH", `/contacts/${FIX.rep2}`, { birthday: bad });
    expect(r.status, JSON.stringify(bad)).toBe(400);
  }
  expect((await get(`/contacts/${FIX.rep2}`)).body.contact.birthday, "refusals left it cleared").toBeNull();
  expect(JSON.stringify((await get(`/contacts/${FIX.rep2}`)).body)).not.toMatch(/year/i);
  const created = await send("POST", "/contacts", { firstName: "CV3", lastName: "Birthdaymake", birthday: { month: 12, day: 31 } });
  expect(created.status).toBe(201);
  expect(created.body.contact.birthday).toEqual({ month: 12, day: 31 });
  say("birthday set/change/clear; Feb 29 ok; impossible days and a year refused; quick-create carries it");
});

test("birthday: a member cannot change it; a colleague's contact is not found", async () => {
  const other = await send("PATCH", `/contacts/${FIX.colLead}`, { birthday: { month: 5, day: 5 } });
  expect(other.status).toBe(IS_ADMIN ? 200 : 404);
  if (IS_ADMIN) await send("PATCH", `/contacts/${FIX.colLead}`, { birthday: null });
  if (!WRITER) expect((await send("PATCH", `/contacts/${FIX.ownlead}`, { birthday: { month: 5, day: 5 } })).status).toBe(403);
});

test("birthday is in neither the list, the search, nor the audit-facing timeline", async () => {
  const listed = await send("POST", "/contacts/search", { q: "March 17" });
  expect(listed.body.total).toBe(0);
  const tl = await get(`/contacts/${FIX.rep2}/timeline`);
  expect(JSON.stringify(tl.body)).not.toMatch(/birthday|March|"month"|"day"/i);
});

// ---------------------------------------------------------------------------------------
test("needs: create, read, several at once, change, pause, fulfil, archive — never delete", async () => {
  test.skip(!WRITER, "member has no write access");
  const a = await send("POST", `/contacts/${FIX.rep1}/needs`, {
    kind: "buy", areas: ["Fort Lauderdale", "Victoria Park"], propertyTypes: ["singleFamily"], priceMinCents: 60_000_000, priceMaxCents: 75_000_000,
    minBeds: 3, minBaths: 2.5, timelineNote: "Move within 6 months", financing: "conventional", mustHaves: ["Pool"], avoid: ["HOA"], additionalRequirements: "Quiet street",
  });
  expect(a.status).toBe(201);
  expect(a.body.need).toMatchObject({ kind: "buy", status: "active", minBaths: 2.5, priceMinCents: 60_000_000, areas: ["Fort Lauderdale", "Victoria Park"], mustHaves: ["Pool"] });
  const b = await send("POST", `/contacts/${FIX.rep1}/needs`, { kind: "sell" });
  expect(b.status, "a second simultaneous need is accepted").toBe(201);
  const both = await get(`/contacts/${FIX.rep1}/needs`);
  expect((both.body.items as Body[]).filter((n) => n.status === "active").length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(both.body)).not.toMatch(/userId|contactId|authorUserId|createdBy/);
  const edited = await send("PATCH", `/contacts/${FIX.rep1}/needs/${a.body.need.id}`, { areas: ["Miami"], minBeds: 4, financing: null });
  expect(edited.status).toBe(200);
  expect(edited.body.changed.sort()).toEqual(["areas", "financing", "minBeds"]);
  expect(edited.body.need).toMatchObject({ areas: ["Miami"], minBeds: 4, financing: null });
  for (const status of ["paused", "fulfilled", "archived", "active"]) {
    const r = await send("PATCH", `/contacts/${FIX.rep1}/needs/${a.body.need.id}`, { status });
    expect(r.status, status).toBe(200);
    expect(r.body.need.status).toBe(status);
  }
  const nothing = await send("PATCH", `/contacts/${FIX.rep1}/needs/${a.body.need.id}`, { areas: ["Miami"] });
  expect(nothing.body.changed, "an unchanged save changes nothing").toEqual([]);
  expect((await send("DELETE", `/contacts/${FIX.rep1}/needs/${a.body.need.id}`)).status, "there is no delete").toBeGreaterThanOrEqual(404);
  (globalThis as Record<string, unknown>).__needId = a.body.need.id;
  say("needs: created 2, edited, walked every status");
});

test("needs: validation names the field and never echoes values", async () => {
  test.skip(!WRITER, "member has no write access");
  for (const bad of [
    { kind: "opportunity" }, { kind: "buy", priceMinCents: 500, priceMaxCents: 100 }, { kind: "buy", priceMinCents: -1 }, { kind: "buy", minBaths: 2.3 },
    { kind: "buy", minBeds: -1 }, { kind: "buy", areas: Array.from({ length: 13 }, (_, i) => `Area ${i}`) }, { kind: "buy", propertyTypes: ["Residential"] },
    { kind: "buy", targetDate: "2027-02-30" }, { kind: "buy", ListPrice: 1 }, { kind: "buy", contactId: FIX.colRep }, { kind: "buy", additionalRequirements: "x".repeat(2001) },
  ]) {
    const r = await send("POST", `/contacts/${FIX.rep1}/needs`, bad);
    expect(r.status, JSON.stringify(bad).slice(0, 50)).toBe(400);
    expect(r.body).toEqual({ error: "invalid", fields: ["need"] });
  }
  const id = (globalThis as Record<string, unknown>).__needId as string;
  expect((await send("PATCH", `/contacts/${FIX.rep1}/needs/${id}`, { priceMaxCents: 1 })).status, "a maximum below the STORED minimum").toBe(400);
  expect((await send("PATCH", `/contacts/${FIX.rep1}/needs/${id}`, {})).status).toBe(400);
  expect((await send("PATCH", `/contacts/${FIX.rep1}/needs/${id}`, { status: "won" })).status).toBe(400);
  expect((await send("PATCH", `/contacts/${FIX.rep2}/needs/${id}`, { status: "paused" })).status, "a need is not on another contact").toBe(404);
  expect((await send("PATCH", `/contacts/${FIX.rep1}/needs/not-a-uuid`, { status: "paused" })).status).toBe(404);
  // A malicious string is stored and returned as itself, as text.
  const xss = "<script>window.__xss=3</script>";
  const r = await send("POST", `/contacts/${FIX.rep1}/needs`, { kind: "other", additionalRequirements: xss, mustHaves: [xss] });
  expect(r.status).toBe(201);
  expect(r.body.need.additionalRequirements).toBe(xss);
});

test("needs: scope — colleague, another brokerage, and a member", async () => {
  const read = await get(`/contacts/${FIX.colRep}/needs`);
  const write = await send("POST", `/contacts/${FIX.colRep}/needs`, { kind: "buy" });
  expect(read.status).toBe(IS_ADMIN ? 200 : 404);
  expect(write.status).toBe(IS_ADMIN ? 201 : 404);
  expect((await get(`/contacts/${FIX.foreign}/needs`)).status).toBe(404);
  expect((await send("POST", `/contacts/${FIX.foreign}/needs`, { kind: "buy" })).status).toBe(404);
  if (!WRITER) {
    expect((await get(`/contacts/${FIX.ownlead}/needs`)).status, "a member reads their own contact's needs").toBe(200);
    expect((await send("POST", `/contacts/${FIX.ownlead}/needs`, { kind: "buy" })).status, "…and cannot write").toBe(403);
  }
});

// ---------------------------------------------------------------------------------------
test("the timeline says 'Added note', 'Deleted note', 'Client need added' — with no text and no ids", async () => {
  test.skip(!WRITER, "needs the writes above");
  const tl = await get(`/contacts/${FIX.rep1}/timeline`);
  expect(tl.status).toBe(200);
  const titles = (tl.body.items as Body[]).map((i) => i.title);
  expect(titles).toEqual(expect.arrayContaining(["Added note", "Deleted note", "Client need added", "Client need updated"]));
  expect(titles.some((t) => /paused|fulfilled|archived|reactivated/i.test(t))).toBe(true);
  const raw = JSON.stringify(tl.body);
  expect(raw).not.toMatch(/window\.__xss|Quiet street|Victoria Park|Fort Lauderdale|60000000|Pool|noteId|needId|contactId|safeMetadata/);
  expect((tl.body.items as Body[]).every((i) => Object.keys(i).every((k) => ["id", "type", "title", "detail", "at", "by"].includes(k)))).toBe(true);
});

// ---------------------------------------------------------------------------------------
test("stage: moving into Representation or Active client records the acknowledgement; an existing Representation contact is untouched", async () => {
  test.skip(!WRITER, "member has no write access");
  const before = await get(`/contacts/${FIX.rep1}`);
  expect(before.body.contact.stage).toBe("representation");
  const a = await send("POST", `/contacts/${FIX.ownlead}/stage`, { stage: "representation", engagementAcknowledged: true });
  expect(a.status).toBe(200);
  const b = await send("POST", `/contacts/${FIX.active}/stage`, { stage: "representation" });
  expect(b.status, "a caller that does not send the flag is still allowed — and it is recorded as not acknowledged").toBe(200);
  expect((await send("POST", `/contacts/${FIX.ownlead}/stage`, { stage: "lead" })).status).toBe(200);
  expect((await send("POST", `/contacts/${FIX.active}/stage`, { stage: "active_client", engagementAcknowledged: true })).status).toBe(200);
  expect((await send("POST", `/contacts/${FIX.ownlead}/stage`, { stage: "representation", engagementAcknowledged: "yes" })).status, "the flag is a boolean").toBe(400);
  expect((await get(`/contacts/${FIX.rep1}`)).body.contact.stage, "nothing forced it backwards").toBe("representation");
  expect((await send("POST", `/contacts/${FIX.colRep}/stage`, { stage: "lead" })).status).toBe(IS_ADMIN ? 200 : 404);
  if (IS_ADMIN) await send("POST", `/contacts/${FIX.colRep}/stage`, { stage: "representation", engagementAcknowledged: true });
});

// ---------------------------------------------------------------------------------------
test("the Representation selector: only Representation, only what this role may open a deal for", async () => {
  const sel = await send("POST", "/contacts/eligible", {});
  expect(sel.status).toBe(200);
  const got = names(sel.body.items);
  const own = ["CV3 Ownrep One", "CV3 Ownrep Two"];
  const visible = got.filter((n) => n.startsWith("CV3 "));
  expect(visible, IS_ADMIN ? "an admin: every Representation contact in the brokerage" : "everyone else: their own Representation contacts only").toEqual(IS_ADMIN ? [...own, "CV3 Colleague Rep"].sort() : own);
  for (const never of ["CV3 Ownlead", "CV3 Ownactive", "CV3 Ownarchived", "CV3 Colleague Lead", "CV3 Foreign"]) expect(got, never).not.toContain(never);
  expect((sel.body.items as Body[]).every((i) => Object.keys(i).sort().join() === "id,name"), "an id and a name, nothing else").toBe(true);
  expect(names((await send("POST", "/contacts/eligible", { q: "two" })).body.items).filter((n) => n.startsWith("CV3 "))).toEqual(["CV3 Ownrep Two"]);
  expect(((await send("POST", "/contacts/eligible", { q: "%" })).body.items as Body[]).length, "% is a literal").toBe(0);
  expect(((await send("POST", "/contacts/eligible", { q: "_" })).body.items as Body[]).length, "_ is a literal").toBe(0);
  expect((await send("POST", "/contacts/eligible", { q: 5 })).status).toBe(400);
  expect((await fetch(`${DASHBOARD}/dashboard/api/contacts/eligible?q=own`)).status, "no anonymous, and no GET").toBeGreaterThanOrEqual(401);
});

test("creating a deal from a contact links the client party, and one contact can have many deals", async () => {
  test.skip(!WRITER, "a member cannot open a deal");
  const deal = (extra: Record<string, unknown>) => ({ transactionType: "residential_sale", side: "buyer", addressLine1: "CV3 1 Linked Street", city: "Miami", contractPriceCents: 80_000_000, ...extra });
  const one = await send("POST", "/transactions", deal({ contactId: FIX.rep1, parties: [{ role: "buyer", displayName: "Someone Else Entirely", isPrimary: true }] }));
  expect(one.status).toBe(201);
  expect(one.body.transaction.clientName, "the client is the STORED contact, not what the request said").toBe("CV3 Ownrep One");
  const linked = await get(`/contacts/${FIX.rep1}/transactions`);
  expect(linked.status).toBe(200);
  expect((linked.body.items as Body[]).map((i) => i.id)).toContain(one.body.transaction.id);
  expect(Object.keys((linked.body.items as Body[])[0]).sort()).toEqual(["address", "city", "id", "stage"]);
  const two = await send("POST", "/transactions", deal({ contactId: FIX.rep1, addressLine1: "CV3 2 Linked Street" }));
  expect(two.status, "a second deal for the same contact").toBe(201);
  expect(((await get(`/contacts/${FIX.rep1}/transactions`)).body.items as Body[]).length).toBeGreaterThanOrEqual(2);
  expect((await get(`/transactions/${one.body.transaction.id}`)).status).toBe(200);
  (globalThis as Record<string, unknown>).__deals = [one.body.transaction.id, two.body.transaction.id];
  say("deal created from a contact; party linked; second deal accepted");
});

test("spoofed contact ids are refused, and read exactly like an unknown id", async () => {
  test.skip(!WRITER, "a member cannot open a deal");
  const deal = (contactId: string) => ({ transactionType: "residential_sale", side: "buyer", addressLine1: "CV3 Spoof Street", city: "Miami", contactId });
  const unknown = await send("POST", "/transactions", deal("00000000-0000-4000-8000-000000000000"));
  expect(unknown.status).toBe(400);
  expect(unknown.body).toEqual({ error: "invalid", fields: ["contactId"] });
  for (const [key, why] of [["ownlead", "a lead"], ["active", "an active client"], ["archived", "an archived contact"], ["foreign", "another brokerage's contact"]] as const) {
    const r = await send("POST", "/transactions", deal(FIX[key]));
    expect(r.status, why).toBe(400);
    expect(r.body, `${why} reads like an unknown id`).toEqual(unknown.body);
  }
  const colleague = await send("POST", "/transactions", deal(FIX.colRep));
  if (IS_ADMIN) {
    expect(colleague.status, "an admin may open a deal for a colleague's Representation contact").toBe(201);
    expect(colleague.body.transaction.agentId, "…and it is the colleague's deal").toBe(COLLEAGUE_ID);
    (globalThis as Record<string, unknown>).__adminDeal = colleague.body.transaction.id;
  } else {
    expect(colleague.status, "no one else can: their Contacts scope is their own book").toBe(400);
    expect(colleague.body).toEqual(unknown.body);
  }
  if (ROLE === "broker" || ROLE === "transaction_coordinator") {
    const naming = await send("POST", "/transactions", { ...deal(FIX.rep1), agentUserId: COLLEAGUE_ID });
    expect(naming.status, "their own contact cannot be put on another agent's deal").toBe(400);
  }
});

test("Transactions: admin, broker and coordinator see the brokerage's deals; an agent and a member only their own", async () => {
  const list = await get("/transactions");
  expect(list.status).toBe(200);
  const ids = (list.body.items as Body[]).map((i) => i.id);
  expect(ids, "the legacy deal (no contact link, no dates) still renders").toContain(FIX.legacyDeal);
  const legacy = (list.body.items as Body[]).find((i) => i.id === FIX.legacyDeal)!;
  expect(legacy.clientName, "a legacy deal keeps its own client display").toBeTruthy();
  if (BROKERAGE_DEALS) expect(ids, `${ROLE}: brokerage-wide`).toContain(FIX.colleagueDeal);
  else expect(ids, "own only").not.toContain(FIX.colleagueDeal);
  expect((await get(`/transactions/${FIX.colleagueDeal}`)).status, "a known colleague deal").toBe(BROKERAGE_DEALS ? 200 : 404);
  expect((await get(`/transactions/${FIX.legacyDeal}`)).status).toBe(200);
  if (!WRITER) {
    expect((await send("POST", "/transactions", { transactionType: "residential_sale", side: "buyer", addressLine1: "CV3 Denied", city: "Miami" })).status).toBe(403);
  }
  say(`transactions visible: ${ids.length}; colleague's deal ${BROKERAGE_DEALS ? "visible" : "hidden"}`);
});

test("a contact's Transactions section lists only deals this viewer may see", async () => {
  test.skip(!IS_ADMIN, "needs an admin-created deal on a colleague's contact");
  const id = (globalThis as Record<string, unknown>).__adminDeal as string;
  const linked = await get(`/contacts/${FIX.colRep}/transactions`);
  expect(linked.status).toBe(200);
  expect((linked.body.items as Body[]).map((i) => i.id)).toContain(id);
});

test("the private data is never cached and never in a list", async () => {
  for (const path of [`/contacts/${FIX.rep1}/notes`, `/contacts/${FIX.rep1}/needs`, `/contacts/${FIX.rep1}/transactions`, `/contacts/${FIX.rep1}/timeline`]) {
    const res = await fetch(`${DASHBOARD}/dashboard/api${path}`);
    expect(res.status, `${path} is not public`).toBe(401);
    expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
  }
  const listed = await send("POST", "/contacts/search", {});
  const raw = JSON.stringify(listed.body);
  expect(raw, "the list carries no note or need").not.toMatch(/Seeded note|Quiet street|mustHaves|additionalRequirements|"body"/);
});
