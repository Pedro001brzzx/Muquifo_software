import { loadEnv } from '../config/env.js';
import { runMigrations } from './migrator.js';

/** Aplica as migrations versionadas em ./drizzle. Usado no dev e, depois, pelo instalador. */
await runMigrations(loadEnv().DATABASE_URL);
console.log('Migrations aplicadas.');
