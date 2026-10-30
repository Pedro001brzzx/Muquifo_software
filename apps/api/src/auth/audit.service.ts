import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import type { Database, Executor } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { auditEvents } from '../db/schema.js';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  approverId?: string | null;
  target?: string | null;
  details?: Record<string, unknown> | null;
}

/** Trava única da corrente: dois registros ao mesmo tempo não bifurcam. */
const CHAIN_LOCK = 4_242_001;
const GENESIS = '0'.repeat(64);

/** JSON com chaves ordenadas: o jsonb do PostgreSQL não preserva a ordem. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const digest = (prevHash: string, at: string, e: AuditEntry) =>
  createHash('sha256')
    .update(
      [
        prevHash,
        at,
        e.action,
        e.actorId ?? '',
        e.approverId ?? '',
        e.target ?? '',
        canonical(e.details ?? null),
      ].join('|'),
    )
    .digest('hex');

/**
 * Registro encadeado de ações (entradas, aprovações do gerente, equipe).
 * Grava na mesma transação da ação: se a ação falhar, o registro também some.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry, executor?: Executor): Promise<void> {
    const write = async (tx: Executor) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${CHAIN_LOCK})`);
      const [last] = await tx
        .select({ hash: auditEvents.hash })
        .from(auditEvents)
        .orderBy(desc(auditEvents.id))
        .limit(1);
      const prevHash = last?.hash ?? GENESIS;
      const at = new Date();
      await tx.insert(auditEvents).values({
        at,
        action: entry.action,
        actorId: entry.actorId ?? null,
        approverId: entry.approverId ?? null,
        target: entry.target ?? null,
        details: entry.details ?? null,
        prevHash,
        hash: digest(prevHash, at.toISOString(), entry),
      });
    };
    if (executor) await write(executor);
    else await this.db.transaction(write);
  }

  /** Confere a corrente inteira; devolve o id da primeira linha adulterada. */
  async verify(): Promise<{
    ok: boolean;
    count: number;
    brokenAt: number | null;
  }> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .orderBy(auditEvents.id);
    let prev = GENESIS;
    for (const row of rows) {
      const expected = digest(prev, row.at.toISOString(), {
        action: row.action,
        actorId: row.actorId,
        approverId: row.approverId,
        target: row.target,
        details: row.details as Record<string, unknown> | null,
      });
      if (row.prevHash !== prev || row.hash !== expected) {
        return { ok: false, count: rows.length, brokenAt: row.id };
      }
      prev = row.hash;
    }
    return { ok: true, count: rows.length, brokenAt: null };
  }
}
