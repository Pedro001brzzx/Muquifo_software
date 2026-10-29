import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './client.js';

const defaultFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Aplica as migrations versionadas em ./drizzle no banco indicado. A versão
 * instalada (servidor num arquivo só) informa a pasta por MIGRATIONS_DIR.
 */
export async function runMigrations(
  databaseUrl: string,
  migrationsFolder = defaultFolder,
): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    await migrate(createDatabase(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
