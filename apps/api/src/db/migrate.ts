import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDatabase, createPool } from './client.js';

/** Aplica as migrations versionadas em ./drizzle. Usado no dev e, depois, pelo instalador. */
const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

const pool = createPool(loadEnv().DATABASE_URL);
try {
  await migrate(createDatabase(pool), { migrationsFolder });
  console.log('Migrations aplicadas.');
} finally {
  await pool.end();
}
