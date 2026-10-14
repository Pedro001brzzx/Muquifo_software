import { readFileSync } from 'node:fs';
import type { Health } from '@muquifo/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';

// Mesmo caminho relativo em src/ (testes) e dist/ (produção).
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Usado pelo diagnóstico de conexão (T01) e pelo monitor do serviço. */
  @Get()
  async check(): Promise<Health> {
    let database: Health['database'] = 'up';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      version,
      serverTime: new Date().toISOString(),
    };
  }
}
