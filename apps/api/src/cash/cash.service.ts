import {
  type addCashMovementSchema,
  type CashSession,
  type closeCashSchema,
  errorCodes,
  formatCents,
  type MethodTotals,
  type openCashSchema,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Executor, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { cashMovements, cashSessions, payments } from '../db/schema.js';

type SessionRow = typeof cashSessions.$inferSelect;

const zero = (): MethodTotals => ({ cash: 0, credit: 0, debit: 0, pix: 0 });
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Monta os caixas com pagamentos, movimentos e totais (esperado ao vivo enquanto aberto). */
export async function loadSessions(
  db: Executor,
  rows: SessionRow[],
): Promise<CashSession[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [paid, moves] = await Promise.all([
    db
      .select({
        sessionId: payments.cashSessionId,
        method: payments.method,
        total: sql<number>`sum(${payments.amountCents})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(
        and(
          inArray(payments.cashSessionId, ids),
          eq(payments.status, 'active'),
        ),
      )
      .groupBy(payments.cashSessionId, payments.method),
    db
      .select()
      .from(cashMovements)
      .where(inArray(cashMovements.sessionId, ids))
      .orderBy(asc(cashMovements.createdAt)),
  ]);

  return rows.map((row) => {
    const received = zero();
    let paymentCount = 0;
    for (const p of paid.filter((x) => x.sessionId === row.id)) {
      received[p.method] = p.total;
      paymentCount += p.count;
    }
    const movements = moves.filter((m) => m.sessionId === row.id);
    const sum = (kind: 'withdrawal' | 'reinforcement') =>
      movements
        .filter((m) => m.kind === kind)
        .reduce((s, m) => s + m.amountCents, 0);
    const withdrawalsCents = sum('withdrawal');
    const reinforcementsCents = sum('reinforcement');
    const closed = row.status === 'closed';
    const expected: MethodTotals = closed
      ? {
          cash: row.expectedCashCents ?? 0,
          credit: row.expectedCreditCents ?? 0,
          debit: row.expectedDebitCents ?? 0,
          pix: row.expectedPixCents ?? 0,
        }
      : {
          ...received,
          cash:
            row.openingFloatCents +
            received.cash +
            reinforcementsCents -
            withdrawalsCents,
        };
    const counted: MethodTotals | null = closed
      ? {
          cash: row.countedCashCents ?? 0,
          credit: row.countedCreditCents ?? 0,
          debit: row.countedDebitCents ?? 0,
          pix: row.countedPixCents ?? 0,
        }
      : null;
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      openedBy: row.openedBy,
      openedAt: row.openedAt.toISOString(),
      openingFloatCents: row.openingFloatCents,
      closedBy: row.closedBy,
      closedAt: iso(row.closedAt),
      notes: row.notes,
      version: row.version,
      paymentCount,
      received,
      withdrawalsCents,
      reinforcementsCents,
      expected,
      counted,
      difference: counted && {
        cash: counted.cash - expected.cash,
        credit: counted.credit - expected.credit,
        debit: counted.debit - expected.debit,
        pix: counted.pix - expected.pix,
      },
      movements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        amountCents: m.amountCents,
        reason: m.reason,
        operator: m.operator,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}

/**
 * Caixa aberto, travado para leitura: pagamentos esperam um fechamento em
 * andamento terminar (e vice-versa). Sem caixa aberto, não se recebe.
 */
export async function lockOpenSession(tx: Transaction): Promise<SessionRow> {
  const [row] = await tx
    .select()
    .from(cashSessions)
    .where(eq(cashSessions.status, 'open'))
    .for('share');
  if (!row) {
    throw new AppException(
      HttpStatus.CONFLICT,
      errorCodes.cashClosed,
      'O caixa está fechado. Abra o caixa para receber pagamentos.',
    );
  }
  return row;
}

@Injectable()
export class CashService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async current(): Promise<CashSession | null> {
    const rows = await this.db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.status, 'open'));
    const [session] = await loadSessions(this.db, rows);
    return session ?? null;
  }

  async list(limit: number): Promise<CashSession[]> {
    const rows = await this.db
      .select()
      .from(cashSessions)
      .orderBy(desc(cashSessions.number))
      .limit(limit);
    return loadSessions(this.db, rows);
  }

  async get(db: Executor, id: string): Promise<CashSession> {
    const rows = await db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, id));
    if (rows.length === 0) throw AppException.notFound('Caixa', id);
    const [session] = await loadSessions(db, rows);
    return session;
  }

  async open(
    tx: Transaction,
    input: z.output<typeof openCashSchema>,
  ): Promise<CashSession> {
    const [existing] = await tx
      .select({ number: cashSessions.number })
      .from(cashSessions)
      .where(eq(cashSessions.status, 'open'));
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.cashAlreadyOpen,
        `O caixa ${existing.number} já está aberto.`,
        { number: existing.number },
      );
    }
    const [row] = await tx
      .insert(cashSessions)
      .values({
        openedBy: input.operator,
        openingFloatCents: input.openingFloatCents,
      })
      .returning({ id: cashSessions.id });
    return this.get(tx, row.id);
  }

  /** Sangria não pode passar do dinheiro que deveria estar na gaveta. */
  async addMovement(
    tx: Transaction,
    id: string,
    input: z.output<typeof addCashMovementSchema>,
  ): Promise<CashSession> {
    const row = await this.lockForUpdate(tx, id);
    if (input.kind === 'withdrawal') {
      const [session] = await loadSessions(tx, [row]);
      if (input.amountCents > session.expected.cash) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          errorCodes.cashInsufficient,
          `A sangria passa do dinheiro esperado na gaveta (${formatCents(session.expected.cash)}).`,
          { expectedCashCents: session.expected.cash },
        );
      }
    }
    await tx.insert(cashMovements).values({ sessionId: row.id, ...input });
    await this.touch(tx, row.id);
    return this.get(tx, row.id);
  }

  /**
   * Fechamento cego: grava o contado e congela o esperado. A trava exclusiva
   * espera pagamentos em andamento (que travam o caixa para leitura).
   */
  async close(
    tx: Transaction,
    id: string,
    input: z.output<typeof closeCashSchema>,
  ): Promise<CashSession> {
    const row = await this.lockForUpdate(tx, id);
    if (row.version !== input.version) {
      throw AppException.versionConflict('Caixa', row.version);
    }
    const [session] = await loadSessions(tx, [row]);
    await tx
      .update(cashSessions)
      .set({
        status: 'closed',
        closedBy: input.operator,
        closedAt: new Date(),
        notes: input.notes,
        expectedCashCents: session.expected.cash,
        expectedCreditCents: session.expected.credit,
        expectedDebitCents: session.expected.debit,
        expectedPixCents: session.expected.pix,
        countedCashCents: input.counted.cash,
        countedCreditCents: input.counted.credit,
        countedDebitCents: input.counted.debit,
        countedPixCents: input.counted.pix,
        version: sql`${cashSessions.version} + 1`,
      })
      .where(eq(cashSessions.id, row.id));
    return this.get(tx, row.id);
  }

  private async lockForUpdate(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, id))
      .for('update');
    if (!row) throw AppException.notFound('Caixa', id);
    if (row.status !== 'open') {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.cashClosed,
        `O caixa ${row.number} já foi fechado.`,
        { number: row.number },
      );
    }
    return row;
  }

  private async touch(tx: Transaction, id: string) {
    await tx
      .update(cashSessions)
      .set({ version: sql`${cashSessions.version} + 1` })
      .where(eq(cashSessions.id, id));
  }
}
