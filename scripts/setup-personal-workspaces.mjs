// Migration 0014 is already part of the atomic, journaled migration runner.
// Retain a fail-closed message for old operator commands; never run direct DDL.
if (process.env.FM_PERSONAL_WORKSPACES_SETUP === 'true') {
  throw new Error('Legacy personal-workspace setup is retired. Use the reviewed atomic migration runner (npm run db:migrate).');
}
