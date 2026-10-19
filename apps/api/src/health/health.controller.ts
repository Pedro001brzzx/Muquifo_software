import { readFileSync } from 'node:fs';
import { type Health, healthSchema } from '@muquifo/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { ApiZodResponse } from '../openapi/api-docs.js';

// Mesmo caminho relativo em src/ (testes) e dist/ (produção).
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

@ApiTags('Sistema')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Usado pelo diagnóstico de conexão (T01) e pelo monitor do serviço. */
  @Get()
  @ApiOperation({
    summary: 'Situação da API e do banco',
    description:
      'Sempre 200; `database: down` indica que a API está no ar mas sem PostgreSQL.',
  })
  @ApiZodResponse({ status: 200, name: 'Health', schema: healthSchema })
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
