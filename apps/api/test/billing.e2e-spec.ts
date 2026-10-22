import { randomInt, randomUUID } from 'node:crypto';
import type {
  ApiError,
  Category,
  DiningTable,
  Order,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';

/** Fechamento de conta, pagamentos e liberação de mesa (RF07, RN04, RN05). */
describe.skipIf(!process.env.DATABASE_URL)('Fechamento de conta (e2e)', () => {
  let app: NestFastifyApplication;
  let pizza: Product; // R$ 50,00

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload,
      headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() },
    });
  const getTab = async (id: string) =>
    (await call('GET', `/tabs/${id}`)).json<TabDetail>();
  const newTable = async () =>
    (
      await call('POST', '/tables', { number: randomInt(1000, 4999) })
    ).json<DiningTable>();
  const tableStatus = async (id: string) =>
    (await call('GET', '/tables'))
      .json<DiningTable[]>()
      .find((t) => t.id === id)?.status;

  /** Comanda numa mesa nova com `pizzas` pizzas já enviadas. */
  async function tabWithConsumption(pizzas: number) {
    const table = await newTable();
    const tab = (
      await call('POST', '/tabs', { tableId: table.id })
    ).json<TabDetail>();
    const order = (
      await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'table',
        submit: true,
        items: [{ productId: pizza.id, quantity: pizzas }],
      })
    ).json<Order>();
    return { table, tab: await getTab(tab.id), order };
  }

  const pay = (tabId: string, body: object) =>
    call('POST', `/tabs/${tabId}/payments`, body);
  const close = (tab: TabDetail) =>
    call('POST', `/tabs/${tab.id}/close`, { version: tab.version });

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const suffix = randomUUID().slice(0, 8);
    const category = (
      await call('POST', '/categories', { name: `Conta ${suffix}` })
    ).json<Category>();
    pizza = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `Pizza ${suffix}`,
        priceCents: 5000,
      })
    ).json<Product>();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('paga em partes, calcula troco e fecha com saldo zero liberando a mesa', async () => {
    const { table, tab } = await tabWithConsumption(2);
    expect(tab).toMatchObject({ totalCents: 10000, balanceCents: 10000 });

    const pix = await pay(tab.id, { method: 'pix', amountCents: 4000 });
    expect(pix.statusCode).toBe(201);
    expect(pix.json<TabDetail>()).toMatchObject({
      paidCents: 4000,
      balanceCents: 6000,
    });

    const early = await close(await getTab(tab.id));
    expect(early.statusCode).toBe(409);
    expect(early.json<ApiError>()).toMatchObject({
      code: 'BALANCE_NOT_ZERO',
      details: { balanceCents: 6000 },
    });

    const tooMuch = await pay(tab.id, { method: 'debit', amountCents: 7000 });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json<ApiError>()).toMatchObject({
      code: 'PAYMENT_EXCEEDS_BALANCE',
      details: { balanceCents: 6000 },
    });

    const cash = await pay(tab.id, {
      method: 'cash',
      amountCents: 6000,
      receivedCents: 10000,
    });
    const paid = cash.json<TabDetail>();
    expect(paid.balanceCents).toBe(0);
    expect(paid.payments.at(-1)).toMatchObject({
      method: 'cash',
      amountCents: 6000,
      receivedCents: 10000,
      changeCents: 4000,
    });
    expect(await tableStatus(table.id)).toBe('occupied');

    const stale = await call('POST', `/tabs/${tab.id}/close`, {
      version: tab.version,
    });
    expect(stale.json<ApiError>().code).toBe('VERSION_CONFLICT');

    const closed = await close(paid);
    expect(closed.statusCode).toBe(200);
    expect(closed.json<TabDetail>()).toMatchObject({
      status: 'closed',
      closedAt: expect.any(String),
    });
    expect(await tableStatus(table.id)).toBe('free');

    const after = await pay(tab.id, { method: 'pix', amountCents: 100 });
    expect(after.json<ApiError>().code).toBe('TAB_NOT_OPEN');
    const order = await call('POST', '/orders', {
      tabId: tab.id,
      channel: 'table',
    });
    expect(order.json<ApiError>().code).toBe('TAB_NOT_OPEN');
  });

  it('valor recebido só em dinheiro e nunca menor que o pagamento', async () => {
    const { tab } = await tabWithConsumption(1);
    const card = await pay(tab.id, {
      method: 'credit',
      amountCents: 1000,
      receivedCents: 2000,
    });
    expect(card.statusCode).toBe(422);
    const short = await pay(tab.id, {
      method: 'cash',
      amountCents: 1000,
      receivedCents: 500,
    });
    expect(short.statusCode).toBe(422);
  });

  it('rascunho com itens impede o fechamento; rascunho vazio é cancelado junto', async () => {
    const { tab } = await tabWithConsumption(1);
    await pay(tab.id, { method: 'pix', amountCents: 5000 });
    const draft = (
      await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'table',
        items: [{ productId: pizza.id }],
      })
    ).json<Order>();

    const blocked = await close(await getTab(tab.id));
    expect(blocked.json<ApiError>()).toMatchObject({
      code: 'DRAFT_ORDERS_PENDING',
      details: { draftItems: 1 },
    });

    await call('POST', `/orders/${draft.id}/cancellations`, {
      reason: 'Cliente desistiu',
    });
    const empty = (
      await call('POST', '/orders', { tabId: tab.id, channel: 'table' })
    ).json<Order>();
    const closed = (await close(await getTab(tab.id))).json<TabDetail>();
    expect(closed.status).toBe('closed');
    expect(closed.orders.find((o) => o.id === empty.id)).toMatchObject({
      status: 'canceled',
      cancelReason: 'Comanda encerrada',
    });
  });

  it('item cancelado depois de pago exige estorno antes de fechar', async () => {
    const { tab, order } = await tabWithConsumption(2);
    const payment = (
      await pay(tab.id, { method: 'credit', amountCents: 10000 })
    ).json<TabDetail>().payments[0];
    await call('POST', `/orders/${order.id}/cancellations`, {
      reason: 'Pizza veio errada',
    });

    const negative = await close(await getTab(tab.id));
    expect(negative.json<ApiError>()).toMatchObject({
      code: 'BALANCE_NOT_ZERO',
      details: { balanceCents: -10000 },
    });

    const refunded = await call(
      'POST',
      `/tabs/${tab.id}/payments/${payment.id}/cancellations`,
      { reason: 'Estorno da pizza errada' },
    );
    expect(refunded.statusCode).toBe(201);
    const after = refunded.json<TabDetail>();
    expect(after.paidCents).toBe(0);
    expect(after.payments[0]).toMatchObject({
      status: 'canceled',
      cancelReason: 'Estorno da pizza errada',
    });

    const twice = await call(
      'POST',
      `/tabs/${tab.id}/payments/${payment.id}/cancellations`,
      { reason: 'De novo' },
    );
    expect(twice.statusCode).toBe(422);

    // Sem consumo nem pagamento ativo, a comanda é liberada em vez de fechada.
    const empty = await close(after);
    expect(empty.json<ApiError>().code).toBe('TAB_EMPTY');
  });

  it('libera a mesa de comanda sem consumo, com motivo, cancelando rascunhos', async () => {
    const table = await newTable();
    const tab = (
      await call('POST', '/tabs', { tableId: table.id })
    ).json<TabDetail>();
    await call('POST', '/orders', {
      tabId: tab.id,
      channel: 'table',
      items: [{ productId: pizza.id }],
    });
    expect(await tableStatus(table.id)).toBe('occupied');

    const noReason = await call('POST', `/tabs/${tab.id}/cancellations`, {
      reason: 'x',
    });
    expect(noReason.statusCode).toBe(422);

    const res = await call('POST', `/tabs/${tab.id}/cancellations`, {
      reason: 'Mesa aberta por engano',
    });
    expect(res.statusCode).toBe(201);
    const canceled = res.json<TabDetail>();
    expect(canceled).toMatchObject({
      status: 'canceled',
      cancelReason: 'Mesa aberta por engano',
      canceledAt: expect.any(String),
    });
    expect(canceled.orders[0]).toMatchObject({ status: 'canceled' });
    expect(canceled.orders[0].items[0]).toMatchObject({ status: 'canceled' });
    expect(await tableStatus(table.id)).toBe('free');

    const again = await call('POST', `/tabs/${tab.id}/cancellations`, {
      reason: 'De novo',
    });
    expect(again.json<ApiError>().code).toBe('TAB_NOT_OPEN');
  });

  it('não libera mesa com consumo enviado', async () => {
    const { table, tab } = await tabWithConsumption(1);
    const res = await call('POST', `/tabs/${tab.id}/cancellations`, {
      reason: 'Tentativa indevida',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>()).toMatchObject({
      code: 'TAB_HAS_CONSUMPTION',
      details: { totalCents: 5000 },
    });
    expect(await tableStatus(table.id)).toBe('occupied');
  });

  it('pagamentos simultâneos do saldo inteiro: só um passa', async () => {
    const { tab } = await tabWithConsumption(1);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        pay(tab.id, { method: 'pix', amountCents: 5000 }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort((a, b) => a - b)).toEqual([
      201, 409, 409, 409,
    ]);
    expect(await getTab(tab.id)).toMatchObject({
      paidCents: 5000,
      balanceCents: 0,
    });
  });
});
