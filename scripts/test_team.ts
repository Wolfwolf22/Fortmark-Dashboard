/**
 * Team roster regression tests (pure; no database).
 *
 * The roster is real data, so what matters is who sees whom and which fields
 * leave the server. Run: npm run test:team
 */
import { rosterFor, toRosterEntry, type RosterSourceRow } from "../lib/team/roster.ts";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean) => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
};

const profile = (over: Partial<NonNullable<RosterSourceRow["profile"]>> = {}) => ({
  preferredDisplayName: null,
  legalFirstName: null,
  legalLastName: null,
  professionalTitle: null,
  licenseState: null,
  licenseType: null,
  licenseNumber: null,
  businessEmail: null,
  ...over,
});

const rows: RosterSourceRow[] = [
  {
    userId: "u-agent",
    role: "agent",
    status: "active",
    accountEmail: "agent-login@example.test",
    createdAt: null,
    profile: profile({ legalFirstName: "Ana", legalLastName: "Diaz", licenseState: "FL", licenseNumber: "SL123", businessEmail: " ana@example.test " }),
    image: { processingStatus: "uploaded", processedImageUrl: null, activeImageUrl: "https://x.public.blob.vercel-storage.com/profile-images/a.jpg", clerkImageUrl: null },
  },
  {
    userId: "u-admin",
    role: "admin",
    status: "active",
    accountEmail: "owner-login@example.test",
    createdAt: null,
    profile: profile({ preferredDisplayName: "Owner", professionalTitle: "Broker" }),
    image: null,
  },
  { userId: "u-pending", role: "member", status: "pending_profile", accountEmail: "p@example.test", createdAt: null, profile: null, image: null },
  { userId: "u-suspended", role: "agent", status: "suspended", accountEmail: "s@example.test", createdAt: null, profile: profile({ preferredDisplayName: "Gone" }), image: { processingStatus: null, processedImageUrl: null, activeImageUrl: "javascript:alert(1)", clerkImageUrl: null } },
];

// --- Visibility -------------------------------------------------------------
const asAdmin = rosterFor(rows, { userId: "u-admin", privileged: true });
const asAgent = rosterFor(rows, { userId: "u-agent", privileged: false });
check("privileged viewer sees every account", asAdmin.length === 4);
check("privileged viewer sees status", asAdmin.every((m) => m.status !== undefined));
check("colleague sees active accounts only", asAgent.length === 2 && asAgent.every((m) => ["u-agent", "u-admin"].includes(m.id)));
check("colleague never receives status", asAgent.every((m) => !("status" in m)));
check("suspended account hidden from colleagues", !asAgent.some((m) => m.id === "u-suspended"));
check("pending account hidden from colleagues", !asAgent.some((m) => m.id === "u-pending"));

// --- Fields -----------------------------------------------------------------
const ana = asAgent.find((m) => m.id === "u-agent")!;
check("self flagged", ana.isSelf && !asAgent.find((m) => m.id === "u-admin")!.isSelf);
check("legal name used when no display name", ana.name === "Ana Diaz" && ana.hasName);
check("published email preferred over login email", ana.email === "ana@example.test");
check("licence carried as self-reported data", ana.licenseNumber === "SL123" && ana.licenseState === "FL");
check("real image url carried", ana.imageUrl?.startsWith("https://") === true);
const owner = asAgent.find((m) => m.id === "u-admin")!;
check("login email is the published fallback, as on the business card", owner.email === "owner-login@example.test");
const pending = asAdmin.find((m) => m.id === "u-pending")!;
check("missing profile never invents a name", !pending.hasName && pending.name === "Name not added yet");
check("missing licence stays null", pending.licenseNumber === null && pending.title === null);
check("unsafe image url dropped", asAdmin.find((m) => m.id === "u-suspended")!.imageUrl === null);
const keys = new Set(asAdmin.flatMap((m) => Object.keys(m)));
for (const forbidden of ["clerkUserId", "accountEmail", "phoneE164", "nrdsNumber", "mlsAgentId", "biography", "createdAt"]) {
  check(`roster never carries ${forbidden}`, !keys.has(forbidden));
}

// --- Ordering ---------------------------------------------------------------
check("senior roles first", asAdmin[0].role === "admin");
check("entry projection is deterministic", JSON.stringify(toRosterEntry(rows[0], { userId: "x", privileged: false })) === JSON.stringify(toRosterEntry(rows[0], { userId: "x", privileged: false })));

// --- Source discipline (static) --------------------------------------------
const route = readFileSync("app/api/team/route.ts", "utf8");
check("route answers sample only in explicit fixture mode", /if \(sampleDashboardEnabled\(\)\)[\s\S]{0,80}source: "sample"/.test(route));
check("route reports not_configured as a 503", /not_configured[\s\S]{0,40}status: 503/.test(route));
const service = readFileSync("lib/team/service.ts", "utf8");
check("service resolves the actor from the session, not the request", service.includes("resolveActor(clerkUserId"));
check("service never imports fixtures", !/mock\/|sample-/.test(service));
const ui = readFileSync("components/settings/team-section.tsx", "utf8");
check("real roster offers no role select", !/function TeamRosterCard[\s\S]*<Select/.test(ui.split("function TeamManager")[0]));
check("real roster states licences are self-reported", ui.includes("self-reported"));

console.log(`${passed}/${passed + failed} team checks passed`);
if (failed > 0) process.exit(1);
