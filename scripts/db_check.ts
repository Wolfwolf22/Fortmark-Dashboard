/**
 * Database health probe. Reports reachability and Release 1 counts only —
 * never identifiers, emails, or any part of a connection string.
 *
 * Exits 0 when unconfigured: an absent database is a valid Release 1 state,
 * because the allowlist is still the access authority.
 *
 * Run: npm run db:check
 */
import { checkDatabase, isDatabaseConfigured } from "../lib/db/client.ts";
import { profileDiagnostics } from "../lib/profile/service.ts";

const configured = isDatabaseConfigured();
console.log(`database configured: ${configured}`);
if (!configured) {
  console.log("no DATABASE_URL — profile features stay disabled; dashboard access is unaffected");
  process.exit(0);
}

const health = await checkDatabase();
if (!health.ok) {
  console.log(`database unreachable (${health.reason})`);
  process.exit(1);
}
console.log(`database reachable in ${health.latencyMs}ms`);

const diag = await profileDiagnostics();
if (diag.ok) {
  console.log(`active users: ${diag.activeUsers}`);
  console.log(`admins:       ${diag.admins}`);
  console.log(`profiles:     ${diag.profiles}`);
} else {
  console.log("diagnostics unavailable (tables may not be migrated yet)");
}
