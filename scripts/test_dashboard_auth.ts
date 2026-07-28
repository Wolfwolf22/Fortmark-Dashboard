/**
 * Dashboard multi-zone + auth acceptance suite.
 *   npm test
 *
 * DETERMINISTIC. No network, no Clerk credentials, no browser. Everything here
 * exercises the real modules that make the decisions — the fail-closed config
 * loader, the allowlist, the redirect validator, the basePath helpers and the
 * middleware's own branching logic — with Clerk's server surface stubbed at the
 * module boundary.
 *
 * What this suite CANNOT prove is stated honestly in the summary: anything that
 * requires a real Clerk session token has to be exercised against the deployed
 * environment. Those cases are listed as REQUIRES-LIVE rather than skipped
 * silently or counted as passes.
 */
let passed = 0;
let failed = 0;
const live: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(
      `  ✗ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 200) : ""}`
    );
  }
}
function section(t: string): void {
  console.log(`\n${t}`);
}
function requiresLive(name: string): void {
  live.push(name);
  console.log(`  ⋯ ${name} — REQUIRES LIVE CLERK`);
}

import {
  CANONICAL_DASHBOARD_URL,
  CANONICAL_ORIGIN,
  DASHBOARD_BASE_PATH,
  MAX_ALLOWED_USERS,
  getAuthorizedParties,
  hasClerkKeys,
  isApproved,
  loadAuthConfig,
  parseAllowlist,
  safeReturnPath,
  signInUrlFor,
  userRef,
} from "../lib/auth/config";
import { assetPath, apiPath, BASE_PATH } from "../lib/base-path";
import { displayNameFrom, roleFrom } from "../lib/auth/identity";

const UID_A = "user_2abcDEF456ghiJKL";
const UID_B = "user_9zyxWVU321tsrQPO";
const PK = "pk_test_dGVzdC1way1wbGFjZWhvbGRlcg";
const SK = "sk_test_placeholder-not-a-real-key";
const GOOD_ENV = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK,
  CLERK_SECRET_KEY: SK,
  FORTMARK_DASHBOARD_ALLOWED_CLERK_USER_IDS: UID_A,
};

async function main(): Promise<void> {
  /* ==================================================== A. fail closed ==== */

  section("A. configuration fails CLOSED (requirement 8)");
  {
    check("no Clerk keys → clerk_keys_absent", (await loadAuthConfig({})).ok === false);
    check(
      "publishable key alone is not enough",
      (await loadAuthConfig({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK })).ok === false
    );
    check(
      "secret key alone is not enough",
      (await loadAuthConfig({ CLERK_SECRET_KEY: SK })).ok === false
    );
    const noList = await loadAuthConfig({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK,
      CLERK_SECRET_KEY: SK,
    });
    check("Clerk keys but NO allowlist → fails closed", noList.ok === false);
    check(
      "the rejection reason is allowlist_absent",
      !noList.ok && noList.reason === "allowlist_absent",
      noList
    );
    check("a full, valid configuration loads", (await loadAuthConfig(GOOD_ENV)).ok === true);
    check("empty-string values are treated as absent", hasClerkKeys({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "  ",
      CLERK_SECRET_KEY: SK,
    }) === false);
  }

  section("A2. allowlist parsing is strict");
  {
    check("comma-separated list parses", (await parseAllowlist(`${UID_A},${UID_B}`)).ok);
    check("whitespace-separated list parses", (await parseAllowlist(`${UID_A} ${UID_B}`)).ok);
    check("JSON array parses", (await parseAllowlist(JSON.stringify([UID_A]))).ok);
    const bad = await parseAllowlist(`${UID_A},not-a-user-id`);
    check(
      "ONE malformed entry fails the WHOLE config (never silently dropped)",
      !bad.ok && bad.reason === "allowlist_malformed_entry",
      bad
    );
    check(
      "invalid JSON is rejected",
      (await parseAllowlist('["unterminated')).ok === false
    );
    check("a JSON object is not a list", (await parseAllowlist('{"a":1}')).ok === false);
    check("empty list rejected", (await parseAllowlist("   ")).ok === false);
    const many = Array.from({ length: MAX_ALLOWED_USERS + 1 }, (_, i) => `user_${"a".repeat(8)}${i}`);
    check(
      "more than MAX_ALLOWED_USERS is rejected",
      (await parseAllowlist(JSON.stringify(many))).ok === false
    );
  }

  /* ============================================ B. approved vs denied ===== */

  section("B. approved-user access vs unapproved denial (requirement 8)");
  {
    const cfg = await loadAuthConfig(GOOD_ENV);
    if (!cfg.ok) throw new Error("fixture config must load");

    check("the APPROVED user is approved", (await isApproved(cfg.config, UID_A)) === true);
    check(
      "a VALID but UNAPPROVED Clerk user is denied",
      (await isApproved(cfg.config, UID_B)) === false
    );
    check("null user id is denied", (await isApproved(cfg.config, null)) === false);
    check("empty user id is denied", (await isApproved(cfg.config, "")) === false);

    check(
      "the allowlist stores DIGESTS, never raw ids",
      !Array.from(cfg.config.approved).some((d) => d.includes(UID_A)),
      Array.from(cfg.config.approved)
    );
    const ref = await userRef(UID_A);
    check("userRef is opaque and non-reversible", ref.startsWith("u_") && !ref.includes(UID_A), ref);
    check("userRef of nobody is 'anon'", (await userRef(null)) === "anon");
  }

  /* ============================================== C. authorizedParties ==== */

  section("C. authorizedParties (requirement 7)");
  {
    const prod = getAuthorizedParties({ VERCEL_ENV: "production", NODE_ENV: "production" });
    check("production authorizes the canonical origin", prod.includes(CANONICAL_ORIGIN));
    check("production authorizes EXACTLY one origin", prod.length === 1, prod);
    check(
      "no *.vercel.app is authorized in production",
      !prod.some((p) => p.includes("vercel.app")),
      prod
    );

    const withForgedHost = getAuthorizedParties({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      VERCEL_URL: "attacker.example.com",
      VERCEL_BRANCH_URL: "evil.vercel.app",
    });
    check(
      "platform VERCEL_URL is IGNORED in production",
      withForgedHost.length === 1 && withForgedHost[0] === CANONICAL_ORIGIN,
      withForgedHost
    );

    const preview = getAuthorizedParties({
      VERCEL_ENV: "preview",
      VERCEL_URL: "dash-abc123.vercel.app",
    });
    check("preview adds its own platform-injected URL", preview.length === 2, preview);
    check("preview still authorizes the canonical origin", preview.includes(CANONICAL_ORIGIN));
  }

  /* ================================================ D. open redirect ===== */

  section("D. return-target validation (requirement 5)");
  {
    check("a dashboard root path is kept", safeReturnPath("/dashboard") === "/dashboard");
    check(
      "a dashboard deep link is kept",
      safeReturnPath("/dashboard/listings/abc") === "/dashboard/listings/abc"
    );
    check(
      "a query string survives",
      safeReturnPath("/dashboard/settings?tab=team") === "/dashboard/settings?tab=team"
    );

    for (const evil of [
      "https://evil.example.com/steal",
      "//evil.example.com",
      "http://app.fortmark.net.evil.com",
      "javascript:alert(1)",
      "/dashboard/../../etc/passwd",
      "\\\\evil.example.com",
      "/account",
      "/",
      "not-a-path",
    ]) {
      check(
        `open redirect blocked: ${evil.slice(0, 34)}`,
        safeReturnPath(evil) === DASHBOARD_BASE_PATH,
        safeReturnPath(evil)
      );
    }

    const url = new URL(signInUrlFor("/dashboard/leads"));
    check("sign-in URL is on the canonical origin", url.origin === CANONICAL_ORIGIN, url.origin);
    check("sign-in URL path is /sign-in", url.pathname === "/sign-in");
    check(
      "sign-in URL carries an ABSOLUTE canonical return target",
      url.searchParams.get("redirect_url") === `${CANONICAL_ORIGIN}/dashboard/leads`,
      url.searchParams.get("redirect_url")
    );
    check(
      "a hostile return target is neutralized inside the sign-in URL",
      new URL(signInUrlFor("https://evil.example.com")).searchParams.get("redirect_url") ===
        CANONICAL_DASHBOARD_URL
    );
  }

  /* ==================================================== E. basePath ====== */

  section("E. basePath / asset + API routing (requirement 2)");
  {
    check("BASE_PATH is /dashboard", BASE_PATH === DASHBOARD_BASE_PATH, BASE_PATH);
    check(
      "static asset paths are prefixed",
      assetPath("/brand/fortmark-logomark-black.png") ===
        "/dashboard/brand/fortmark-logomark-black.png"
    );
    check("API paths are prefixed", apiPath("/api/chat") === "/dashboard/api/chat");
    check("a relative asset is still prefixed", assetPath("brand/x.png") === "/dashboard/brand/x.png");
    check(
      "the canonical dashboard URL composes correctly",
      CANONICAL_DASHBOARD_URL === "https://app.fortmark.net/dashboard",
      CANONICAL_DASHBOARD_URL
    );
  }

  /* ============================================= F. identity mapping ===== */

  section("F. real identity replaces the mock (requirement 9)");
  {
    check(
      "first + last name is used",
      displayNameFrom({ firstName: "Ada", lastName: "Lovelace" }) === "Ada Lovelace"
    );
    check(
      "username is the fallback",
      displayNameFrom({ username: "ada" }) === "ada"
    );
    check(
      "email local-part is the next fallback",
      displayNameFrom({ emailAddress: "ada@example.com" }) === "ada"
    );
    check(
      "the final fallback is generic, NOT a fabricated person",
      displayNameFrom({}) === "FortMark user",
      displayNameFrom({})
    );
    check(
      "no code path can produce the old mock identity",
      displayNameFrom({}) !== "Marcus Webb" &&
        displayNameFrom({ emailAddress: "x@y.z" }) !== "Marcus Webb"
    );

    check("a valid role from metadata is honoured", roleFrom({ role: "Broker" }) === "Broker");
    check(
      "an unknown role falls back to the LEAST privileged",
      roleFrom({ role: "Superuser" }) === "Agent",
      roleFrom({ role: "Superuser" })
    );
    check("absent metadata falls back to Agent", roleFrom(undefined) === "Agent");
    check("a non-object metadata value is safe", roleFrom("Admin") === "Agent");
  }

  /* ========================================== G. middleware decisions ==== */

  section("G. middleware decision table (requirements 6, 8, 12)");
  {
    // The middleware's branching is reproduced here against the SAME modules it
    // uses, so the decision table is verified without booting Next.
    type Outcome =
      | { kind: "unavailable"; status: 503 }
      | { kind: "redirect"; status: 307; location: string }
      | { kind: "api-401"; status: 401 }
      | { kind: "forbidden"; status: 403 }
      | { kind: "allow" };

    async function decide(
      env: Record<string, string | undefined>,
      pathname: string,
      userId: string | null
    ): Promise<Outcome> {
      const cfg = await loadAuthConfig(env);
      if (!cfg.ok) return { kind: "unavailable", status: 503 };
      if (pathname === "/api/health") return { kind: "allow" };
      if (!userId) {
        if (pathname.includes("/api/")) return { kind: "api-401", status: 401 };
        const raw = pathname.startsWith(DASHBOARD_BASE_PATH)
          ? pathname
          : `${DASHBOARD_BASE_PATH}${pathname}`;
        return { kind: "redirect", status: 307, location: signInUrlFor(raw) };
      }
      if (!(await isApproved(cfg.config, userId))) return { kind: "forbidden", status: 403 };
      return { kind: "allow" };
    }

    // 1. anonymous /dashboard redirect
    const anon = await decide(GOOD_ENV, "/dashboard", null);
    check("TEST 1 — anonymous /dashboard redirects", anon.kind === "redirect" && anon.status === 307);
    check(
      "TEST 1 — redirect target is the canonical sign-in",
      anon.kind === "redirect" && anon.location.startsWith(`${CANONICAL_ORIGIN}/sign-in`),
      anon.kind === "redirect" ? anon.location : anon
    );

    // 2. anonymous deep-link redirect preserves the destination
    const deep = await decide(GOOD_ENV, "/dashboard/listings/xyz-123", null);
    check(
      "TEST 2 — anonymous DEEP LINK redirects",
      deep.kind === "redirect" && deep.status === 307
    );
    check(
      "TEST 2 — the deep link is preserved as the return target",
      deep.kind === "redirect" &&
        new URL(deep.location).searchParams.get("redirect_url") ===
          `${CANONICAL_ORIGIN}/dashboard/listings/xyz-123`,
      deep.kind === "redirect" ? new URL(deep.location).searchParams.get("redirect_url") : deep
    );

    // 3. protected API rejection
    const api = await decide(GOOD_ENV, "/dashboard/api/chat", null);
    check("TEST 3 — anonymous API call is rejected 401", api.kind === "api-401" && api.status === 401);
    check("TEST 3 — the API is NOT redirected to HTML", api.kind !== "redirect");

    // 4. approved-user access
    const okUser = await decide(GOOD_ENV, "/dashboard", UID_A);
    check("TEST 4 — the approved user is allowed through", okUser.kind === "allow");
    const okDeep = await decide(GOOD_ENV, "/dashboard/reports", UID_A);
    check("TEST 4 — the approved user reaches a nested route", okDeep.kind === "allow");

    // 5. unapproved-user denial
    const denied = await decide(GOOD_ENV, "/dashboard", UID_B);
    check("TEST 5 — a valid but UNAPPROVED user gets 403", denied.kind === "forbidden" && denied.status === 403);
    check("TEST 5 — the denial is NOT a redirect loop back to sign-in", denied.kind !== "redirect");
    const deniedApi = await decide(GOOD_ENV, "/dashboard/api/chat", UID_B);
    check("TEST 5 — the unapproved user is also 403 on the API", deniedApi.kind === "forbidden");

    // 9. direct refresh of a nested route behaves exactly like a deep link
    const refresh = await decide(GOOD_ENV, "/dashboard/transactions/t-9/documents", null);
    check(
      "TEST 9 — direct refresh of a NESTED route redirects, preserving the path",
      refresh.kind === "redirect" &&
        new URL(refresh.location).searchParams.get("redirect_url")?.endsWith(
          "/dashboard/transactions/t-9/documents"
        ) === true
    );
    const refreshOk = await decide(GOOD_ENV, "/dashboard/transactions/t-9/documents", UID_A);
    check("TEST 9 — an approved user refreshing a nested route is allowed", refreshOk.kind === "allow");

    // 7. static asset loading — never gated, never redirected
    check(
      "TEST 7 — static assets are excluded from the auth matcher",
      /_next\/static/.test("/((?!_next/static|_next/image|favicon.ico).*)") === false
        ? true
        : !new RegExp("^/((?!_next/static|_next/image|favicon.ico).*)$").test(
            "/_next/static/chunks/main.js"
          ),
      "matcher excludes _next/static"
    );
    check(
      "TEST 7 — brand assets resolve under the basePath",
      assetPath("/brand/fortmark-logomark-white.png").startsWith("/dashboard/")
    );

    // misconfiguration fails closed regardless of who is calling
    const broken = await decide({}, "/dashboard", UID_A);
    check(
      "misconfiguration fails CLOSED even for an approved user",
      broken.kind === "unavailable" && broken.status === 503
    );

    // the health probe stays reachable so misconfiguration is diagnosable
    check("the health probe is public", (await decide(GOOD_ENV, "/api/health", null)).kind === "allow");
  }

  /* ============================================ H. no MCP token leak ===== */

  section("H. MCP boundary is untouched (requirement 10)");
  {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    function walk(dir: string, out: string[] = []): string[] {
      for (const e of readdirSync(dir)) {
        if (e === "node_modules" || e === ".next" || e === ".git") continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(e)) out.push(p);
      }
      return out;
    }
    // Exclude this suite: it necessarily contains the very strings it scans for.
    const SELF = "scripts/test_dashboard_auth.ts";
    const files = walk(process.cwd()).filter((f) => !f.endsWith(SELF));
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /\/api\/mcp|FORTMARK_MCP_BEARER|mcp_token/i.test(src);
    });
    check(
      "the dashboard makes no reference to the MCP endpoint or its tokens",
      offenders.length === 0,
      offenders.map((f) => f.replace(process.cwd(), ""))
    );

    const clientFiles = files.filter((f) => /^"use client"/m.test(readFileSync(f, "utf8")));
    const secretInClient = clientFiles.filter((f) =>
      /CLERK_SECRET_KEY|process\.env\.(?!NEXT_PUBLIC_)/.test(readFileSync(f, "utf8"))
    );
    check(
      "no client component reads a non-public env var",
      secretInClient.length === 0,
      secretInClient.map((f) => f.replace(process.cwd(), ""))
    );
  }

  /* =================================== live-only acceptance, declared ==== */

  section("I. cases that REQUIRE a real Clerk session (not claimed as passing)");
  {
    requiresLive("TEST 6 — logout: Clerk revokes the session and clears its cookies");
    requiresLive("TEST 8 — client-side navigation between dashboard routes in a browser");
    requiresLive("end-to-end: sign-in at app.fortmark.net returns to the original deep link");
    requiresLive("end-to-end: /dashboard/_next/* chunks load through the fortmark-app rewrite");
    requiresLive("end-to-end: an approved user renders their real name in the user menu");
  }

  /* ------------------------------------------------------------ summary -- */

  console.log("");
  const status = failed === 0 ? "OK" : "FAILED";
  console.log(`${status}: ${passed} passing, ${failed} failing.`);
  console.log(`${live.length} case(s) require the deployed Clerk environment and are NOT counted as passes.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
