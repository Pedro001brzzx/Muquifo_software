import pg from 'pg';
import { runMigrations } from '../src/db/migrator.js';
import { testDatabaseUrl } from './test-database.js';

/** Antes de cada rodada: estrutura atualizada e banco de testes vazio. */
export default async function setup() {
  const url = testDatabaseUrl();
  if (!url) return;
  try {
    await runMigrations(url);
  } catch (error) {
    // 3D000: banco inexistente; o usuário da aplicação não tem permissão para criá-lo.
    // O Drizzle embrulha o erro do pg em `cause`.
    const e = error as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === '3D000') {
      const name = new URL(url).pathname.slice(1);
      throw new Error(
        `Banco de testes "${name}" não existe. Crie como superusuário (pgAdmin/psql):\n` +
          `  CREATE DATABASE ${name} OWNER muquifo;`,
      );
    }
    throw error;
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      `select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`,
    );
    if (rows.length > 0) {
      await client.query(
        `truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade`,
      );
    }
  } finally {
    await client.end();
  }
}
