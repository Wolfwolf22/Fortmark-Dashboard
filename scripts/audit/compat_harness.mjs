/**
 * Compatibility harness — NOT part of `npm test` (needs PostgreSQL binaries and, for the old-runtime
 * run, a git worktree of the revision under test).
 *
 * Builds a throwaway PostgreSQL cluster, migrates it to this repository's head (0013), seeds
 * Production-shaped legacy rows, and answers the Neon HTTP SQL protocol from it (`neonConfig.fetchFunction`).
 * The runtime under test then runs its REAL services, with its OWN drizzle schema, against that database.
 *
 *   git worktree add --detach /tmp/old74 74ff9d4 && ln -s "$PWD/node_modules" /tmp/old74/node_modules
 *   COMPAT_ROOT=/tmp/old74 COMPAT_SCRIPT=$PWD/scripts/audit/compat_old.mjs PG_BIN=/usr/lib/postgresql/16/bin \
 *     node --experimental-strip-types --conditions=react-server --no-warnings scripts/audit/compat_harness.mjs
 *   COMPAT_ROOT=$PWD COMPAT_SCRIPT=$PWD/scripts/audit/compat_new.mjs ...   (same flags: this revision)
 *   COMPAT_BREAK=1 ...  drops a column first: the negative control, it must FAIL.
 *
 * Synthetic data only. Nothing here connects to Neon or reads an environment secret.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, chownSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect as tcpConnect, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, neonConfig } from "@neondatabase/serverless";
import { runMigrations } from "../migrate-core.mjs";

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
const ROOT = process.env.COMPAT_ROOT;            // the runtime under test (a git worktree or this repo)
const LABEL = process.env.COMPAT_LABEL ?? "runtime";
const MIGRATIONS = new URL("../../lib/db/migrations", import.meta.url).pathname;
const results = [];
const ok = (name, cond, extra = "") => { results.push([name, Boolean(cond)]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };

await new Promise((r) => setTimeout(r, 10));
// --- a Production-shaped database, migrated to the HEAD schema (0013) ---------------------
const adminClient = new Client({ connectionString: urlFor("postgres") });
await adminClient.connect();
await adminClient.query("create database compat");
await adminClient.end();
const url = urlFor("compat");
await runMigrations(url, { migrationsFolder: MIGRATIONS });
const pg = new Client({ connectionString: url });
await pg.connect();
const U1 = "a0000000-0000-4000-8000-000000000001", U2 = "a0000000-0000-4000-8000-000000000002";
const C1 = "b0000000-0000-4000-8000-000000000001", C2 = "b0000000-0000-4000-8000-000000000002";
const T1 = "e0000000-0000-4000-8000-000000000001", T2 = "e0000000-0000-4000-8000-000000000002";
const seed = [
  ["insert into dashboard_users (id, clerk_user_id, primary_email, status, role) values ($1,'user_LEGACY1','legacy1@example.invalid','active','admin'), ($2,'user_LEGACY2','legacy2@example.invalid','active','agent')", [U1, U2]],
  ["insert into professional_profiles (user_id, preferred_display_name, legal_first_name, legal_last_name) values ($1,'Alex Admin','Alex','Admin'), ($2,'Bea Agent','Bea','Agent')", [U1, U2]],
  ["insert into contacts (id, brokerage_key, assigned_agent_user_id, created_by_user_id, first_name, last_name, source, stage, notes, tags) values ($1,'fortmark',$3,$3,'Legacy','Representation','referral','representation','An old free-text note','[\"vip\"]'::jsonb), ($2,'fortmark',$4,$4,'Legacy','Lead','website','lead',null,'[]'::jsonb)", [C1, C2, U1, U2]],
  ["insert into contact_activities (contact_id, actor_user_id, kind, summary) values ($1,$2,'note','Logged a note'), ($1,$2,'status_change','Stage changed'), ($1,$2,'call','Called')", [C1, U1]],
  ["insert into contact_opportunities (contact_id, kind, status, area) values ($1,'buyer','open','Brickell')", [C1]],
  ["insert into transactions (id, brokerage_key, agent_user_id, created_by_user_id, transaction_type, side, stage, address_line1, city) values ($1,'fortmark',$3,$3,'residential_sale','listing','opportunity','1 Legacy St','Miami'), ($2,'fortmark',$4,$4,'residential_sale','buyer','under_contract','2 Legacy Ave','Miami')", [T1, T2, U1, U2]],
  ["insert into transaction_parties (transaction_id, role, display_name, is_primary) values ($1,'seller','Legacy Seller',true), ($2,'buyer','Legacy Buyer',true)", [T1, T2]],
];
for (const [t, p] of seed) await pg.query(t, p);

// --- A Neon HTTP SQL endpoint, answered from the local database ------------------------------
const rawTypes = { getTypeParser: () => (v) => v };
async function runOne(c, q) {
  const r = await c.query({ text: q.query, values: q.params ?? [], rowMode: "array", types: rawTypes });
  return { command: r.command, rowCount: r.rowCount, rows: r.rows, fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID, tableID: f.tableID, columnID: f.columnID, dataTypeSize: f.dataTypeSize, dataTypeModifier: f.dataTypeModifier, format: "text" })), rowAsArray: true };
}
let queryCount = 0;
neonConfig.fetchFunction = async (_url, init) => {
  const body = JSON.parse(init.body);
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    if (body.queries) {
      queryCount += body.queries.length;
      await c.query("begin");
      try {
        const results = [];
        for (const q of body.queries) results.push(await runOne(c, q));
        await c.query("commit");
        return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      }
    }
    queryCount += 1;
    return new Response(JSON.stringify(await runOne(c, body)), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ message: String(e.message), code: e.code, severity: "ERROR" }), { status: 400, headers: { "content-type": "application/json" } });
  } finally {
    await c.end().catch(() => {});
  }
};

const { neon } = await import("@neondatabase/serverless");
const { drizzle } = await import("drizzle-orm/neon-http");
const schema = await import(`${ROOT}/lib/db/schema.ts`);
const db = drizzle(neon("postgres://shim:shim@db.example.invalid/compat"), { schema });
const admin = { userId: U1, role: "admin", brokerageKey: "fortmark" };
const agent = { userId: U2, role: "agent", brokerageKey: "fortmark" };
const ctxA = { actor: admin, db };
const ctxB = { actor: agent, db };

if (process.env.COMPAT_BREAK) await pg.query("alter table contacts drop column email");
const mod = process.env.COMPAT_SCRIPT;
await (await import(mod)).run({ ROOT, db, ctxA, ctxB, admin, agent, ok, pg, ids: { U1, U2, C1, C2, T1, T2 }, import_: (p) => import(`${ROOT}/${p}`), LABEL });

const bad = results.filter(([, c]) => !c).length;
console.log(`\n${LABEL}: ${results.length - bad}/${results.length} compatibility checks passed (${queryCount} statements through the shim)`);
await pg.end();
proxy.close();
try { run(join(BIN, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]); } catch {}
rmSync(dir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
