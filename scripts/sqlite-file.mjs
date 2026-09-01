/* Prisma normally creates a SQLite file during `db push`, but some supported
   Node/Prisma combinations return only an empty "Schema engine error" when the
   file does not exist yet. Create the zero-byte file first; SQLite still owns
   the schema and all subsequent writes. Existing databases are never opened
   for writing here, so rerunning setup cannot touch merchant data. */

import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function sqliteFilePath(databaseUrl, schemaFile) {
  if (!databaseUrl.startsWith('file:')) return null;

  const [encodedPath, query = ''] = databaseUrl.slice('file:'.length).split('?', 2);
  if (encodedPath === ':memory:' || new URLSearchParams(query).get('mode') === 'memory') return null;

  const databasePath = decodeURIComponent(encodedPath);
  const schemaPath = schemaFile instanceof URL ? fileURLToPath(schemaFile) : schemaFile;
  return isAbsolute(databasePath) ? databasePath : resolve(dirname(schemaPath), databasePath);
}

export function ensureSqliteFile(databaseUrl, schemaFile) {
  const databasePath = sqliteFilePath(databaseUrl, schemaFile);
  if (!databasePath) return { path: null, created: false };

  mkdirSync(dirname(databasePath), { recursive: true });
  try {
    closeSync(openSync(databasePath, 'wx'));
    return { path: databasePath, created: true };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return { path: databasePath, created: false };
  }
}
