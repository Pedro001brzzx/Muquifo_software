import { randomUUID } from 'node:crypto';
import type { CurrentCash } from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Pagamentos exigem caixa aberto: abre um se não houver. */
export async function ensureCashOpen(app: NestFastifyApplication) {
  const { session } = (
    await app.inject({ method: 'GET', url: '/api/v1/cash/current' })
  ).json<CurrentCash>();
  if (session) return session;
  return (
    await app.inject({
      method: 'POST',
      url: '/api/v1/cash/sessions',
      payload: { openingFloatCents: 0 },
      headers: { 'idempotency-key': randomUUID() },
    })
  ).json();
}
