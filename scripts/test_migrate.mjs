/**
 * Migration runner integration test — real Postgres, real driver, no Neon.
 *
 * Proves the properties the Production promotion found missing:
 *
 *   1. a fresh database receives every committed migration, with bookkeeping
 *      identical to what drizzle records (hash + folder millis);
 *   2. a re-run is a no-op;
 *   3. a batch that fails part-way leaves NOTHING behind — not the earlier
 *      statements of the failing migration, not an earlier migration in the
 *      same batch, not a bookkeeping row;
 *   4. two runners started together serialise on the advisory lock and apply
 *      each migration exactly once;
 *   5. a migration Postgres cannot run inside a transaction is refused before
 *      anything connects.
 *
 * `runMigrations` is exercised unmodified, through `@neondatabase/serverless`
 * over WebSocket — the same code path a Preview build uses — by pointing the
 * driver at a throwaway local cluster through a minimal WebSocket→TCP bridge.
 * No Neon credential is needed or touched.
 *
 * Needs PostgreSQL server binaries (initdb/pg_ctl). Without them it says
 * SKIPPED loudly and exits 0; it is therefore not part of `npm test`, and a
 * SKIPPED run is not evidence. Run: npm run test:migrate
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect as tcpConnect, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, neonConfig } from "@neondatabase/serverless";
import { MIGRATION_LOCK_KEY, assertTransactionSafe, runMigrations } from "./migrate-core.mjs";

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
};

// --- Locate PostgreSQL -------------------------------------------------------
function pgBin() {
  if (process.env.PG_BIN && existsSync(join(process.env.PG_BIN, "initdb"))) return process.env.PG_BIN;
  const root = "/usr/lib/postgresql";
  if (!existsSync(root)) return null;
  for (const v of readdirSync(root).sort().reverse()) {
    const dir = join(root, v, "bin");
    if (existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl"))) return dir;
  }
  return null;
}
const BIN = pgBin();
if (!BIN) {
  console.log("SKIPPED: no PostgreSQL server binaries (set PG_BIN). This run proves nothing.");
  process.exit(0);
}

// initdb refuses to run as root; run the cluster as the `postgres` user then.
const asRoot = process.getuid?.() === 0;
function pgUid() {
  const r = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
}
function run(cmd, args) {
  if (asRoot) return execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], { stdio: "pipe" });
  return execFileSync(cmd, args, { stdio: "pipe" });
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createTcpServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// --- Throwaway cluster -------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "fm-migrate-"));
if (asRoot) {
  const uid = pgUid();
  if (uid === null) {
    console.log("SKIPPED: running as root and no `postgres` user to own the cluster.");
    process.exit(0);
  }
  chownSync(dir, uid, uid);
}
chmodSync(dir, 0o700);
const data = join(dir, "data");
const pgPort = await freePort();
run(join(BIN, "initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "--no-sync"]);
run(join(BIN, "pg_ctl"), [
  "-D", data, "-l", join(dir, "log"), "-w",
  "-o", `-p ${pgPort} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
  "start",
]);

// --- Minimal WebSocket → TCP bridge (Neon's wsproxy protocol) ---------------
// The driver opens ws://<proxy>/v1?address=host:port and then speaks the
// Postgres wire protocol inside binary frames. Only what that needs is here.
function encodeFrame(payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x82, len]) : len < 65536 ? Buffer.from([0x82, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x82; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}
const proxy = createHttpServer();
proxy.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const target = new URL(req.url, "http://x").searchParams.get("address") ?? `127.0.0.1:${pgPort}`;
  const [host, port] = target.split(":");
  const pg = tcpConnect(Number(port), host === "localhost" ? "127.0.0.1" : host);
  pg.on("data", (chunk) => socket.write(encodeFrame(chunk)));
  pg.on("close", () => socket.destroy());
  pg.on("error", () => socket.destroy());
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = (buf[1] & 0x80) !== 0;
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskOff + (i % 4)];
      buf = buf.subarray(off + len);
      if (op === 0x8) { pg.end(); socket.end(); return; }
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0x2 || op === 0x0 || op === 0x1) pg.write(payload);
    }
  });
  socket.on("close", () => pg.destroy());
  socket.on("error", () => pg.destroy());
});
const proxyPort = await freePort();
await new Promise((r) => proxy.listen(proxyPort, "127.0.0.1", r));

neonConfig.wsProxy = (host, port) => `127.0.0.1:${proxyPort}/v1?address=${host}:${port}`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineConnect = false;
neonConfig.pipelineTLS = false;

const urlFor = (db) => `postgres://postgres@127.0.0.1:${pgPort}/${db}`;
async function query(db, text, params) {
  const c = new Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}
async function freshDb(name) {
  await query("postgres", `create database ${name}`);
  return urlFor(name);
}

// Migrations folder helpers.
const REAL = "./lib/db/migrations";
const realJournal = JSON.parse(readFileSync(`${REAL}/meta/_journal.json`, "utf8"));
function folderWith(extra) {
  const f = mkdtempSync(join(tmpdir(), "fm-mig-folder-"));
  cpSync(REAL, f, { recursive: true });
  const journal = JSON.parse(readFileSync(`${f}/meta/_journal.json`, "utf8"));
  let when = journal.entries.at(-1).when;
  for (const [tag, sql] of extra) {
    when += 1000;
    writeFileSync(`${f}/${tag}.sql`, sql);
    journal.entries.push({ idx: journal.entries.length, version: "7", when, tag, breakpoints: true });
  }
  writeFileSync(`${f}/meta/_journal.json`, JSON.stringify(journal, null, 2));
  return f;
}
const expectedHash = (tag, folder = REAL) =>
  createHash("sha256").update(readFileSync(`${folder}/${tag}.sql`).toString()).digest("hex");

try {
  // 1. Fresh apply.
  {
    const url = await freshDb("fresh");
    const r = await runMigrations(url);
    check("fresh database: 0 -> every committed migration", r.before === 0 && r.after === realJournal.entries.length);
    const rows = await query("fresh", "select hash, created_at from drizzle.__drizzle_migrations order by created_at");
    check("bookkeeping hashes are drizzle's (sha256 of each file)",
      rows.length === realJournal.entries.length &&
      rows.every((row, i) => row.hash === expectedHash(realJournal.entries[i].tag) && Number(row.created_at) === realJournal.entries[i].when));
    const t = await query("fresh", "select to_regclass('public.contacts') c, to_regclass('public.transactions') t, to_regclass('public.ai_prepared_actions') a");
    check("schema objects exist after apply", Boolean(t[0].c && t[0].t && t[0].a));
    const b = await query("fresh", "select to_regclass('public.brokerage_identities') b, to_regclass('public.brokerage_identities_brokerage_key_key') u");
    check("0009 creates brokerage_identities with its unique brokerage key", Boolean(b[0].b && b[0].u));
    let dup = false;
    try {
      await query("fresh", "insert into brokerage_identities (brokerage_key, display_name) values ('k', 'A'), ('k', 'B')");
    } catch {
      dup = true;
    }
    check("a second identity for one brokerage key is refused", dup);
    const l = await query("fresh", "select to_regclass('public.mls_member_links') t");
    check("0010 creates mls_member_links", Boolean(l[0].t));
    await query("fresh", "insert into dashboard_users (clerk_user_id, primary_email, status, role) values ('user_testmigrate0001', 'm@x.test', 'active', 'agent')");
    await query("fresh", "insert into mls_member_links (user_id, status) select id, 'linked' from dashboard_users where clerk_user_id = 'user_testmigrate0001'");
    let badStatus = "";
    try {
      await query("fresh", "update mls_member_links set status = 'verified_by_magic'");
    } catch (e) {
      badStatus = String(e?.message ?? e);
    }
    check("an unknown MLS link status is refused by the database", /mls_member_links_status_check/.test(badStatus));

    // 2. Idempotent.
    const again = await runMigrations(url);
    check("re-run applies nothing", again.before === again.after && again.after === realJournal.entries.length);
  }

  // 3a. A failing statement rolls back its whole migration.
  {
    const url = await freshDb("partial");
    await runMigrations(url);
    const folder = folderWith([
      ["9001_probe_fails", 'CREATE TABLE "probe_should_not_exist" ("id" integer);\n--> statement-breakpoint\nSELECT 1/0;'],
    ]);
    let threw = false;
    try { await runMigrations(url, { migrationsFolder: folder }); } catch { threw = true; }
    check("a failing migration throws", threw);
    const t = await query("partial", "select to_regclass('public.probe_should_not_exist') p, (select count(*)::int from drizzle.__drizzle_migrations) n");
    check("earlier statements of the failed migration are rolled back", t[0].p === null);
    check("no bookkeeping row for the failed migration", t[0].n === realJournal.entries.length);
    rmSync(folder, { recursive: true, force: true });
  }

  // 3b. A failure rolls back the whole batch, including an earlier good migration.
  {
    const url = await freshDb("batch");
    await runMigrations(url);
    const folder = folderWith([
      ["9002_probe_good", 'CREATE TABLE "probe_good" ("id" integer);'],
      ["9003_probe_bad", 'CREATE TABLE "probe_bad" ("id" integer);\n--> statement-breakpoint\nCREATE TABLE "probe_bad" ("id" integer);'],
    ]);
    let threw = false;
    try { await runMigrations(url, { migrationsFolder: folder }); } catch { threw = true; }
    const t = await query("batch", "select to_regclass('public.probe_good') g, to_regclass('public.probe_bad') b, (select count(*)::int from drizzle.__drizzle_migrations) n");
    check("a batch with a failing migration throws", threw);
    check("an earlier good migration in the same batch is rolled back too", t[0].g === null && t[0].b === null);
    check("bookkeeping unchanged after a failed batch", t[0].n === realJournal.entries.length);
    // And once fixed, the same batch applies cleanly — no half-state to trip on.
    writeFileSync(`${folder}/9003_probe_bad.sql`, 'CREATE TABLE "probe_bad" ("id" integer);');
    const r = await runMigrations(url, { migrationsFolder: folder });
    const u = await query("batch", "select to_regclass('public.probe_good') g, to_regclass('public.probe_bad') b");
    check("after the fix the batch applies with no leftover state", r.after === r.before + 2 && u[0].g !== null && u[0].b !== null);
    rmSync(folder, { recursive: true, force: true });
  }

  // 4. Concurrent runners serialise on the advisory lock.
  {
    const url = await freshDb("concurrent");
    const [a, b] = await Promise.allSettled([runMigrations(url), runMigrations(url)]);
    check("both concurrent runners succeed", a.status === "fulfilled" && b.status === "fulfilled");
    const n = await query("concurrent", "select count(*)::int n, count(distinct hash)::int d from drizzle.__drizzle_migrations");
    check("each migration recorded exactly once under concurrency", n[0].n === realJournal.entries.length && n[0].d === realJournal.entries.length);
    // A bigint advisory key is split across classid (high) and objid (low 32 bits).
    const held = await query(
      "concurrent",
      "select count(*)::int n from pg_locks where locktype = 'advisory' and classid::bigint = $1 and objid::bigint = $2",
      [Math.floor(MIGRATION_LOCK_KEY / 2 ** 32), MIGRATION_LOCK_KEY % 2 ** 32]
    );
    check("the advisory lock is released afterwards", held[0].n === 0);
  }

  // 5. Non-transactional DDL is refused before connecting.
  {
    const folder = folderWith([["9004_probe_concurrently", 'CREATE INDEX CONCURRENTLY "x" ON "contacts" ("email");']]);
    let msg = "";
    try { assertTransactionSafe(folder); } catch (e) { msg = String(e.message); }
    check("CREATE INDEX CONCURRENTLY is refused up front", msg.includes("9004_probe_concurrently"));
    const enumFolder = folderWith([["9005_probe_enum", "ALTER TYPE \"contact_stage\" ADD VALUE 'x';"]]);
    let msg2 = "";
    try { assertTransactionSafe(enumFolder); } catch (e) { msg2 = String(e.message); }
    check("ALTER TYPE … ADD VALUE is refused up front", msg2.includes("9005_probe_enum"));
    check("every committed migration is transaction-safe", assertTransactionSafe() === realJournal.entries.length);
    rmSync(folder, { recursive: true, force: true });
    rmSync(enumFolder, { recursive: true, force: true });
  }

  // Static: the build entrypoint uses the atomic core and nothing else.
  {
    const entry = readFileSync("scripts/migrate.mjs", "utf8");
    check("migrate.mjs applies migrations only through runMigrations", entry.includes("runMigrations(url") && !entry.includes("neon-http/migrator"));
    check("migrate.mjs keeps the Preview-only build guard", entry.includes('process.env.VERCEL_ENV !== "preview"'));
  }
} finally {
  proxy.close();
  try { run(join(BIN, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]); } catch {}
  rmSync(dir, { recursive: true, force: true });
}

console.log(`${passed}/${passed + failed} migration runner checks passed`);
process.exit(failed > 0 ? 1 : 0);
