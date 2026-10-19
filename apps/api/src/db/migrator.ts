import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './client.js';

const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

/** Aplica as migrations versionadas em ./drizzle no banco indicado. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    await migrate(createDatabase(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
