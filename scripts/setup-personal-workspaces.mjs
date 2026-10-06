import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
// A narrowly scoped additive setup, separate from the existing migration runner.
// No existing table or record is altered. Deployment fails if setup cannot finish.
if (process.env.FM_PERSONAL_WORKSPACES_SETUP === 'true') {
  const url=process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if(!url)throw new Error('Personal workspace database is not configured');
  await neon(url).query(readFileSync('lib/db/migrations/0014_personal_workspaces.sql','utf8'));
  console.log('Personal workspace table ready');
}
