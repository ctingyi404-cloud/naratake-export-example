/* Prepares the database for whatever DATABASE_URL points at, so deploys are
   zero-touch: Vercel runs this via `vercel-build`, Docker runs it on boot.
   - postgres URL → flips the prisma provider automatically
   - pushes the schema (create-only; never drops data on its own)
   - seeds ONLY when the database is empty (SEED_IF_EMPTY guard) */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ensureSqliteFile } from './sqlite-file.mjs';

/* Prisma loads .env for its child process, but this wrapper also needs the URL
   to prepare a brand-new SQLite file. Node 22's loader preserves real process
   env values, so deployment secrets still win over local defaults. */
try {
  process.loadEnvFile();
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const url = process.env.DATABASE_URL ?? 'file:./dev.db';
const isPg = /^postgres(ql)?:/.test(url);
const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);

let schema = readFileSync(schemaPath, 'utf-8');
const original = schema;
const want = isPg ? 'postgresql' : 'sqlite';
if (!schema.includes(`provider = "${want}"`)) {
  schema = schema.replace(/provider\s*=\s*"(sqlite|postgresql)"/, `provider = "${want}"`);
  console.log(`▸ prisma datasource provider → ${want}`);
}
// serverless best practice: runtime through the pooler (DATABASE_URL),
// schema pushes through the direct connection (DIRECT_URL).
// Toggle SYMMETRICALLY: inject for postgres+DIRECT_URL, remove otherwise —
// a schema that traveled through a postgres deploy must still run on sqlite.
const wantDirect = isPg && !!process.env.DIRECT_URL;
const hasDirect = /directUrl\s*=\s*env\("DIRECT_URL"\)/.test(schema);
if (wantDirect && !hasDirect) {
  schema = schema.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/,
    'url      = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")',
  );
  console.log('▸ prisma directUrl → env(DIRECT_URL)');
}
if (!wantDirect && hasDirect) {
  schema = schema.replace(/\n\s*directUrl\s*=\s*env\("DIRECT_URL"\)/, '');
  console.log('▸ prisma directUrl removed (not needed for this DATABASE_URL)');
}
if (schema !== original) writeFileSync(schemaPath, schema);

if (!isPg) {
  const sqlite = ensureSqliteFile(url, schemaPath);
  if (sqlite.created) console.log(`▸ sqlite database created → ${sqlite.path}`);
}

const run = (cmd, extraEnv = {}) => {
  console.log('▸', cmd);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
};

/* A freshly provisioned serverless Postgres (Neon et al) can spend its first
   seconds with the compute still waking, and the very first connection of a
   deploy meets it cold — P1001 "can't reach" that cures itself moments later.
   One build failure for a timing artifact wastes the merchant's whole deploy,
   so the schema push alone retries with a pause; a genuinely wrong URL still
   fails, just three times slower. */
{
  let pushed = false;
  for (let attempt = 1; attempt <= 3 && !pushed; attempt += 1) {
    try {
      run('npx prisma db push --skip-generate');
      pushed = true;
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`▸ attempt ${attempt} failed; database may still be waking — retrying in 10s`);
      execSync('sleep 10');
    }
  }
}
run('npx prisma generate');
run('npx tsx prisma/seed.ts', { SEED_IF_EMPTY: '1' });
console.log('✓ database ready');
