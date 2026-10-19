import type { FastifyReply } from 'fastify';
import type { IdempotentResult } from './idempotency.service.js';

/** Marca respostas repetidas para o cliente saber que nada novo foi feito. */
export function sendIdempotent<T>(
  reply: FastifyReply,
  result: IdempotentResult<T>,
): T {
  if (result.replayed) void reply.header('idempotent-replayed', 'true');
  return result.body;
}
