/**
 * A local stand-in for the Bridge RESO endpoint, for tests.
 *
 * Implements the OData subset the dashboard actually sends — `$filter` with
 * eq/ne/ge/le, and/or, parentheses and contains(); `$orderby`; `$top`;
 * `$skip`; `$count` — over fixture rows, and records every request so a test
 * can assert on the query the service built and on how the credential
 * travelled. It also plays the failures a real upstream can return.
 *
 * Deliberately strict where Bridge is strict: a filter naming a field no row
 * carries answers 400, exactly as Bridge does for an unknown field.
 */
import { createServer, type Server } from "node:http";

export type Row = Record<string, unknown>;

export interface RecordedRequest {
  path: string;
  resource: string;
  params: URLSearchParams;
  hasBearer: boolean;
  bearerValue: string | null;
}

/** Rows per resource. Member and Office are optional roster fixtures. */
export interface StubRows {
  Property: Row[];
  Media: Row[];
  Member?: Row[];
  Office?: Row[];
}

export type StubMode = "ok" | "unauthorized" | "bad_request" | "rate_limited" | "hang";

export interface Stub {
  baseUrl: string;
  requests: RecordedRequest[];
  mode: StubMode;
  rows: StubRows;
  close(): Promise<void>;
}

// --- $filter -----------------------------------------------------------------

type Tok = { t: "lp" | "rp" | "and" | "or" | "ident" | "str" | "num" | "bool" | "op" | "comma"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { out.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { out.push({ t: "rp", v: c }); i++; continue; }
    if (c === ",") { out.push({ t: "comma", v: c }); i++; continue; }
    if (c === "'") {
      let j = i + 1; let s = "";
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") { s += "'"; j += 2; continue; }
        if (src[j] === "'") break;
        s += src[j]; j++;
      }
      out.push({ t: "str", v: s }); i = j + 1; continue;
    }
    const d = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?/.exec(src.slice(i));
    if (d) { out.push({ t: "str", v: d[0] }); i += d[0].length; continue; }
    const m = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (m) { out.push({ t: "num", v: m[0] }); i += m[0].length; continue; }
    const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (w) {
      const word = w[0];
      const lower = word.toLowerCase();
      if (lower === "and" || lower === "or") out.push({ t: lower, v: lower });
      else if (lower === "true" || lower === "false") out.push({ t: "bool", v: lower });
      else if (["eq", "ne", "ge", "le", "gt", "lt"].includes(lower)) out.push({ t: "op", v: lower });
      else out.push({ t: "ident", v: word });
      i += word.length; continue;
    }
    throw new Error(`unexpected character ${c}`);
  }
  return out;
}

type Pred = (row: Row, fields: Set<string>) => boolean;

class Parser {
  i = 0;
  private readonly toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  expect(t: Tok["t"]) { const k = this.next(); if (!k || k.t !== t) throw new Error(`expected ${t}`); return k; }

  parseOr(): Pred {
    let left = this.parseAnd();
    while (this.peek()?.t === "or") { this.next(); const right = this.parseAnd(); const l = left; left = (r, f) => l(r, f) || right(r, f); }
    return left;
  }
  parseAnd(): Pred {
    let left = this.parsePrimary();
    while (this.peek()?.t === "and") { this.next(); const right = this.parsePrimary(); const l = left; left = (r, f) => l(r, f) && right(r, f); }
    return left;
  }
  parsePrimary(): Pred {
    const k = this.peek();
    if (!k) throw new Error("unexpected end");
    if (k.t === "lp") { this.next(); const p = this.parseOr(); this.expect("rp"); return p; }
    if (k.t === "ident" && k.v.toLowerCase() === "contains") {
      this.next(); this.expect("lp"); const field = this.expect("ident").v; this.expect("comma"); const needle = this.expect("str").v; this.expect("rp");
      return (row, fields) => { if (!fields.has(field)) throw new UnknownField(field); const v = row[field]; return typeof v === "string" && v.toLowerCase().includes(needle.toLowerCase()); };
    }
    const field = this.expect("ident").v;
    const op = this.expect("op").v;
    const lit = this.next();
    if (!lit || (lit.t !== "str" && lit.t !== "num" && lit.t !== "bool")) throw new Error("expected literal");
    const value: string | number | boolean =
      lit.t === "num" ? Number(lit.v) : lit.t === "bool" ? lit.v === "true" : lit.v;
    return (row, fields) => {
      if (!fields.has(field)) throw new UnknownField(field);
      const v = row[field];
      switch (op) {
        case "eq": return v === value || (typeof v === "string" && typeof value === "string" && v.slice(0, 10) === value && field.endsWith("Date"));
        case "ne": return v !== value;
        case "ge": return typeof v === "number" ? v >= (value as number) : typeof v === "string" ? v >= String(value) : false;
        case "le": return typeof v === "number" ? v <= (value as number) : typeof v === "string" ? v <= String(value) : false;
        case "gt": return typeof v === "number" && v > (value as number);
        case "lt": return typeof v === "number" && v < (value as number);
        default: return false;
      }
    };
  }
}

class UnknownField extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`unknown field ${field}`);
    this.field = field;
  }
}

function compilePredicate(filter: string): Pred {
  const p = new Parser(tokenize(filter));
  const pred = p.parseOr();
  if (p.peek()) throw new Error("trailing tokens");
  return pred;
}

function fieldSet(rows: Row[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) s.add(k);
  return s;
}

// --- server ------------------------------------------------------------------

export async function startStub(rows: StubRows): Promise<Stub> {
  const requests: RecordedRequest[] = [];
  const stub: Stub = { baseUrl: "", requests, mode: "ok", rows, close: async () => {} };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // [dataset, resource]
    const resource = parts[1] ?? "";
    const authz = req.headers.authorization ?? null;
    requests.push({
      path: url.pathname,
      resource,
      params: url.searchParams,
      hasBearer: Boolean(authz && authz.startsWith("Bearer ")),
      bearerValue: authz ? authz.replace(/^Bearer\s+/i, "") : null,
    });

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (stub.mode === "hang") return; // never answers; the client's deadline decides
    if (stub.mode === "unauthorized") return json(401, { error: { code: 401, message: "Unauthorized request" } });
    if (stub.mode === "rate_limited") return json(429, { error: { code: 429, message: "Too Many Requests" } });
    if (stub.mode === "bad_request") return json(400, { error: { code: 400, message: "Bad Request" } });

    const source =
      resource === "Media" || resource === "Property" || resource === "Member" || resource === "Office"
        ? (stub.rows[resource] ?? null)
        : null;
    if (!source) return json(404, { error: { code: 404, message: "Not found" } });
    const fields = fieldSet(source);

    let matched: Row[];
    try {
      const filter = url.searchParams.get("$filter");
      const pred = filter ? compilePredicate(filter) : () => true;
      matched = source.filter((r) => pred(r, fields));
    } catch (error) {
      // Bridge answers 400 for an unknown field or a malformed filter.
      return json(400, { error: { code: 400, message: error instanceof Error ? error.message : "bad filter" } });
    }

    const orderby = url.searchParams.get("$orderby");
    if (orderby) {
      const [field, dir] = orderby.trim().split(/\s+/);
      if (!fields.has(field)) return json(400, { error: { code: 400, message: `unknown field ${field}` } });
      const mult = (dir ?? "asc").toLowerCase() === "desc" ? -1 : 1;
      matched = [...matched].sort((a, b) => {
        const va = a[field] as string | number | undefined;
        const vb = b[field] as string | number | undefined;
        if (va === vb) return 0;
        if (va === undefined || va === null) return 1;
        if (vb === undefined || vb === null) return -1;
        return (va < vb ? -1 : 1) * mult;
      });
    }

    const total = matched.length;
    const skip = Number(url.searchParams.get("$skip") ?? 0) || 0;
    const top = Number(url.searchParams.get("$top") ?? matched.length) || matched.length;
    const page = matched.slice(skip, skip + top);
    const body: Record<string, unknown> = { value: page };
    if (url.searchParams.get("$count") === "true") body["@odata.count"] = total;
    if (skip + top < total) body["@odata.nextLink"] = `${stub.baseUrl}${url.pathname}?$skip=${skip + top}`;
    return json(200, body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  stub.baseUrl = `http://127.0.0.1:${port}`;
  stub.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
  return stub;
}
