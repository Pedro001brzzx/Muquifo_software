import { randomUUID } from 'node:crypto';
import type {
  ApiError,
  CashSession,
  Category,
  CurrentCash,
  Dashboard,
  Order,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';

/** Caixa: abertura, sangria/suprimento, fechamento cego e painel do dia. */
describe.skipIf(!process.env.DATABASE_URL)('Caixa e painel (e2e)', () => {
  let app: NestFastifyApplication;
  let product: Product; // R$ 40,00

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload,
      headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() },
    });
  const current = async () =>
    (await call('GET', '/cash/current')).json<CurrentCash>().session;
  /** Fecha conferindo exatamente o esperado (sem diferença). */
  const closeExact = (s: CashSession) =>
    call('POST', `/cash/sessions/${s.id}/close`, {
      version: s.version,
      operator: 'Testes',
      counted: s.expected,
    });

  /** Comanda com `n` itens enviados (R$ 40,00 cada). */
  async function tabWith(n: number) {
    const tab = (await call('POST', '/tabs', {})).json<TabDetail>();
    (
      await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'counter',
        submit: true,
        items: [{ productId: product.id, quantity: n }],
      })
    ).json<Order>();
    return tab;
  }

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const tag = randomUUID().slice(0, 8);
    const category = (
      await call('POST', '/categories', { name: `Caixa ${tag}` })
    ).json<Category>();
    product = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `Prato ${tag}`,
        priceCents: 4000,
      })
    ).json<Product>();
    // Começa sem caixa aberto (outro arquivo pode ter deixado um).
    const open = await current();
    if (open) await closeExact(open);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sem caixa aberto não recebe; só um caixa aberto por vez', async () => {
    const tab = await tabWith(1);
    const res = await call('POST', `/tabs/${tab.id}/payments`, {
      method: 'pix',
      amountCents: 4000,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().code).toBe('CASH_CLOSED');

    const opened = await call('POST', '/cash/sessions', {
      operator: 'Ana',
      openingFloatCents: 10000,
    });
    expect(opened.statusCode).toBe(201);
    const again = await call('POST', '/cash/sessions', {
      operator: 'Bia',
      openingFloatCents: 0,
    });
    expect(again.json<ApiError>().code).toBe('CASH_ALREADY_OPEN');
  });

  it('fecha às cegas: congela o esperado e grava a diferença', async () => {
    let session = (await current())!;
    // Dinheiro: R$ 50 entregues para R$ 40 (troco 10); PIX: R$ 40.
    const a = await tabWith(1);
    await call('POST', `/tabs/${a.id}/payments`, {
      method: 'cash',
      amountCents: 4000,
      receivedCents: 5000,
    });
    const b = await tabWith(1);
    const pix = (
      await call('POST', `/tabs/${b.id}/payments`, {
        method: 'pix',
        amountCents: 4000,
      })
    ).json<TabDetail>();
    expect(pix.payments[0].cashSessionId).toBe(session.id);

    await call('POST', `/cash/sessions/${session.id}/movements`, {
      kind: 'reinforcement',
      amountCents: 2000,
      reason: 'Troco extra',
    });
    const tooMuch = await call(
      'POST',
      `/cash/sessions/${session.id}/movements`,
      { kind: 'withdrawal', amountCents: 999_999, reason: 'Depósito' },
    );
    expect(tooMuch.json<ApiError>().code).toBe('CASH_INSUFFICIENT');
    session = (
      await call('POST', `/cash/sessions/${session.id}/movements`, {
        kind: 'withdrawal',
        amountCents: 3000,
        reason: 'Depósito no banco',
        operator: 'Ana',
      })
    ).json<CashSession>();

    // 100 de fundo + 40 recebido + 20 suprimento − 30 sangria.
    expect(session.expected).toEqual({
      cash: 13000,
      credit: 0,
      debit: 0,
      pix: 4000,
    });
    expect(session.paymentCount).toBe(2);
    expect(session.movements.map((m) => m.kind)).toEqual([
      'reinforcement',
      'withdrawal',
    ]);

    const closed = (
      await call('POST', `/cash/sessions/${session.id}/close`, {
        version: session.version,
        operator: 'Ana',
        counted: { cash: 12500, credit: 0, debit: 0, pix: 4000 },
      })
    ).json<CashSession>();
    expect(closed.status).toBe('closed');
    expect(closed.difference).toEqual({
      cash: -500,
      credit: 0,
      debit: 0,
      pix: 0,
    });

    // Fechado: sem movimentos; estorno depois não muda o que foi conferido.
    const late = await call('POST', `/cash/sessions/${session.id}/movements`, {
      kind: 'reinforcement',
      amountCents: 100,
      reason: 'Atrasado',
    });
    expect(late.json<ApiError>().code).toBe('CASH_CLOSED');
    await call(
      'POST',
      `/tabs/${b.id}/payments/${pix.payments[0].id}/cancellations`,
      {
        reason: 'Lançado errado',
      },
    );
    const history = (await call('GET', '/cash/sessions?limit=5')).json<
      CashSession[]
    >();
    const same = history.find((s) => s.id === session.id)!;
    expect(same.expected.pix).toBe(4000);
    expect(same.difference?.cash).toBe(-500);

    // Painel do dia: diferença de caixa e estorno aparecem como atenção.
    const dash = (await call('GET', '/dashboard')).json<Dashboard>();
    expect(dash.attention.cashDifferences).toContainEqual(
      expect.objectContaining({ number: closed.number, differenceCents: -500 }),
    );
    expect(dash.attention.refunds.count).toBeGreaterThanOrEqual(1);
    expect(dash.salesCents).toBeGreaterThanOrEqual(3 * 4000);
    expect(dash.byHour).toHaveLength(24);
    expect(dash.topProducts.some((p) => p.name === product.name)).toBe(true);
    expect(dash.cash).toBeNull();
  });

  it('painel mostra cancelamento depois de enviado', async () => {
    const tab = (await call('POST', '/tabs', {})).json<TabDetail>();
    const order = (
      await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'counter',
        submit: true,
        items: [{ productId: product.id, quantity: 1 }],
      })
    ).json<Order>();
    await call('POST', `/orders/${order.id}/cancellations`, {
      reason: 'Cliente desistiu',
    });
    const dash = (await call('GET', '/dashboard')).json<Dashboard>();
    expect(dash.attention.canceledItems.recent[0]).toMatchObject({
      productName: product.name,
      reason: 'Cliente desistiu',
      tabCode: tab.code,
    });

    const bad = await call('GET', '/dashboard?date=22-10-2026');
    expect(bad.statusCode).toBe(422);
  });
});
