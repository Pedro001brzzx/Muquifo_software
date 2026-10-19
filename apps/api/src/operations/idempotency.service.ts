import { createHash } from 'node:crypto';
import { errorCodes, type Operation } from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { operations } from '../db/schema.js';

const keySchema = z.uuid();

/** JSON com chaves ordenadas, para que o mesmo conteúdo gere sempre o mesmo hash. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface IdempotentResult<T> {
  body: T;
  replayed: boolean;
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Executa `effect` uma única vez por chave (RNF03, RNF06).
   *
   * A chave é reservada com INSERT no início da transação. Um reenvio concorrente
   * fica bloqueado no índice único até a primeira transação terminar: se ela
   * confirmou, o reenvio recebe o resultado gravado; se falhou, a chave fica livre.
   * Erros não são gravados, então um reenvio após erro tenta a operação de novo.
   */
  async execute<T>(
    params: {
      key: string | undefined;
      scope: string;
      payload: unknown;
      statusCode: number;
    },
    effect: (tx: Transaction) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const key = keySchema.safeParse(params.key);
    if (!key.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        errorCodes.idempotencyKeyRequired,
        'Envie o header Idempotency-Key com um UUID por operação.',
      );
    }
    const requestHash = createHash('sha256')
      .update(stableStringify({ scope: params.scope, payload: params.payload }))
      .digest('hex');

    return this.db.transaction(async (tx) => {
      const [reserved] = await tx
        .insert(operations)
        .values({ id: key.data, scope: params.scope, requestHash })
        .onConflictDoNothing()
        .returning({ id: operations.id });

      if (!reserved) {
        const [existing] = await tx
          .select()
          .from(operations)
          .where(eq(operations.id, key.data));
        if (existing.requestHash !== requestHash) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            errorCodes.idempotencyKeyReused,
            'Esta Idempotency-Key já foi usada com outro conteúdo.',
            { operationId: key.data, scope: existing.scope },
          );
        }
        return { body: existing.response as T, replayed: true };
      }

      const body = await effect(tx);
      await tx
        .update(operations)
        .set({ response: body, statusCode: params.statusCode })
        .where(eq(operations.id, key.data));
      return { body, replayed: false };
    });
  }

  async find(operationId: string): Promise<Operation> {
    const [row] = await this.db
      .select()
      .from(operations)
      .where(eq(operations.id, operationId));
    if (!row) throw AppException.notFound('Operação', operationId);
    return {
      operationId: row.id,
      scope: row.scope,
      statusCode: row.statusCode ?? 0,
      response: row.response,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
