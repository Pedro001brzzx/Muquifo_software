import { randomInt, randomUUID } from 'node:crypto';
import type {
  ApiError,
  Category,
  DiningTable,
  Operation,
  Order,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { createApp } from '../src/app.factory.js';
import { PG_POOL } from '../src/db/database.module.js';

/**
 * Regras de comandas e pedidos (RF03–RF05, RN02, RN05, RNF03, RNF04).
 * Requer PostgreSQL com migrations aplicadas; cria seus próprios dados.
 */
describe.skipIf(!process.env.DATABASE_URL)('Comandas e pedidos (e2e)', () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let pizza: Product; // R$ 50,00, inteiro
  let acai: Product; // R$ 40,00/kg, fracionado
  let off: Product; // indisponível
  let table: DiningTable;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const call = (
    method: Method,
    url: string,
    payload?: object,
    key: string | null = randomUUID(),
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload,
      headers: key ? { 'idempotency-key': key } : {},
    });

  const openTab = async (tableId: string | null = null) =>
    (await call('POST', '/tabs', { tableId })).json<TabDetail>();

  const draftOrder = async (tabId: string, items: object[] = []) =>
    (
      await call('POST', '/orders', { tabId, channel: 'counter', items })
    ).json<Order>();

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = app.get(PG_POOL);

    const suffix = randomUUID().slice(0, 8);
    const category = (
      await call('POST', '/categories', { name: `Pedidos ${suffix}` })
    ).json<Category>();
    const product = async (name: string, priceCents: number, extra = {}) =>
      (
        await call('POST', '/products', {
          categoryId: category.id,
          name: `${name} ${suffix}`,
          priceCents,
          ...extra,
        })
      ).json<Product>();
    pizza = await product('Pizza', 5000);
    acai = await product('Açaí kg', 4000, { allowFractional: true });
    off = await product('Fora', 1000);
    await call('PATCH', `/products/${off.id}/availability`, {
      available: false,
      version: off.version,
    });
    table = (
      await call('POST', '/tables', { number: randomInt(5000, 9999) })
    ).json<DiningTable>();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('comandas', () => {
    it('abrir comanda na mesa deixa a mesa ocupada', async () => {
      const tab = await openTab(table.id);
      expect(tab).toMatchObject({
        status: 'open',
        tableId: table.id,
        tableNumber: table.number,
        totalCents: 0,
        balanceCents: 0,
        orders: [],
      });
      const tables = (await call('GET', '/tables')).json<DiningTable[]>();
      expect(tables.find((t) => t.id === table.id)?.status).toBe('occupied');
    });

    it('mesa inexistente é recusada', async () => {
      const res = await call('POST', '/tabs', { tableId: randomUUID() });
      expect(res.statusCode).toBe(422);
    });

    it('pedido de mesa exige comanda com mesa', async () => {
      const tab = await openTab();
      const res = await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'table',
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('idempotência (RNF03)', () => {
    it('mutação sem Idempotency-Key é recusada', async () => {
      const res = await call('POST', '/tabs', {}, null);
      expect(res.statusCode).toBe(400);
      expect(res.json<ApiError>().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('reenvio com a mesma chave devolve o mesmo pedido sem duplicar', async () => {
      const tab = await openTab();
      const key = randomUUID();
      const body = {
        tabId: tab.id,
        channel: 'counter',
        items: [{ productId: pizza.id }],
        submit: true,
      };
      const first = await call('POST', '/orders', body, key);
      const second = await call('POST', '/orders', body, key);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.json<Order>().id).toBe(first.json<Order>().id);

      const detail = (await call('GET', `/tabs/${tab.id}`)).json<TabDetail>();
      expect(detail.orders).toHaveLength(1);
      expect(detail.totalCents).toBe(5000);

      const op = (await call('GET', `/operations/${key}`)).json<Operation>();
      expect(op).toMatchObject({ scope: 'POST /orders', statusCode: 201 });
      expect((op.response as Order).id).toBe(first.json<Order>().id);
    });

    it('envios simultâneos com a mesma chave criam um único pedido', async () => {
      const tab = await openTab();
      const key = randomUUID();
      const body = {
        tabId: tab.id,
        channel: 'counter',
        items: [{ productId: pizza.id }],
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => call('POST', '/orders', body, key)),
      );
      const ids = new Set(results.map((r) => r.json<Order>().id));
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      expect(ids.size).toBe(1);
      const detail = (await call('GET', `/tabs/${tab.id}`)).json<TabDetail>();
      expect(detail.orders).toHaveLength(1);
    });

    it('mesma chave com conteúdo diferente é rejeitada', async () => {
      const tab = await openTab();
      const key = randomUUID();
      await call('POST', '/orders', { tabId: tab.id, channel: 'counter' }, key);
      const res = await call(
        'POST',
        '/orders',
        { tabId: tab.id, channel: 'pickup' },
        key,
      );
      expect(res.statusCode).toBe(422);
      expect(res.json<ApiError>().code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('operação desconhecida retorna 404', async () => {
      const res = await call('GET', `/operations/${randomUUID()}`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('itens e preço (RF05, RN01, RN02)', () => {
    it('preço vem do servidor e fica congelado no item', async () => {
      const tab = await openTab();
      const order = await draftOrder(tab.id, [
        { productId: pizza.id, quantity: 2, notes: 'sem cebola' },
      ]);
      expect(order.items[0]).toMatchObject({
        productName: pizza.name,
        unitPriceCents: 5000,
        quantity: 2,
        totalCents: 10000,
        notes: 'sem cebola',
        sectorId: null,
      });

      await pool.query('update products set price_cents = 5500 where id = $1', [
        pizza.id,
      ]);
      try {
        const after = (await call('GET', `/orders/${order.id}`)).json<Order>();
        expect(after.items[0].unitPriceCents).toBe(5000);

        const added = (
          await call('POST', `/orders/${order.id}/items`, {
            productId: pizza.id,
          })
        ).json<Order>();
        expect(added.items[1].unitPriceCents).toBe(5500);
        expect(added.totalCents).toBe(15500);

        const stale = await call('POST', `/orders/${order.id}/items`, {
          productId: pizza.id,
          expectedUnitPriceCents: 5000,
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json<ApiError>()).toMatchObject({
          code: 'PRICE_CHANGED',
          details: { currentUnitPriceCents: 5500 },
        });
      } finally {
        await pool.query(
          'update products set price_cents = 5000 where id = $1',
          [pizza.id],
        );
      }
    });

    it('quantidade fracionada só em produto que permite', async () => {
      const tab = await openTab();
      const order = await draftOrder(tab.id);
      const bad = await call('POST', `/orders/${order.id}/items`, {
        productId: pizza.id,
        quantity: 1.5,
      });
      expect(bad.statusCode).toBe(422);

      const ok = (
        await call('POST', `/orders/${order.id}/items`, {
          productId: acai.id,
          quantity: 0.333,
        })
      ).json<Order>();
      // 4000 × 0,333 = 1332 centavos, arredondado no servidor.
      expect(ok.items[0]).toMatchObject({ quantity: 0.333, totalCents: 1332 });
    });

    it('produto indisponível é recusado', async () => {
      const tab = await openTab();
      const order = await draftOrder(tab.id);
      const res = await call('POST', `/orders/${order.id}/items`, {
        productId: off.id,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<ApiError>().code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('rascunho permite remover item; o total acompanha', async () => {
      const tab = await openTab();
      const order = await draftOrder(tab.id, [
        { productId: pizza.id },
        { productId: acai.id, quantity: 1 },
      ]);
      const res = await call(
        'DELETE',
        `/orders/${order.id}/items/${order.items[0].id}`,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json<Order>()).toMatchObject({ totalCents: 4000 });
      expect(res.json<Order>().items).toHaveLength(1);
    });
  });

  describe('envio (RF04)', () => {
    it('envio exige a versão revisada e ao menos um item', async () => {
      const tab = await openTab();
      const empty = await draftOrder(tab.id);
      const res = await call('POST', `/orders/${empty.id}/submit`, {
        version: empty.version,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<ApiError>().code).toBe('EMPTY_ORDER');

      const order = await draftOrder(tab.id, [{ productId: pizza.id }]);
      const changed = (
        await call('POST', `/orders/${order.id}/items`, { productId: pizza.id })
      ).json<Order>();
      const stale = await call('POST', `/orders/${order.id}/submit`, {
        version: order.version,
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json<ApiError>().code).toBe('VERSION_CONFLICT');

      const sent = await call('POST', `/orders/${order.id}/submit`, {
        version: changed.version,
      });
      expect(sent.statusCode).toBe(200);
      expect(sent.json<Order>()).toMatchObject({ status: 'submitted' });
      expect(sent.json<Order>().submittedAt).toBeTruthy();
    });

    it('só pedidos enviados somam na conta; rascunho aparece à parte', async () => {
      const tab = await openTab();
      await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'counter',
        items: [{ productId: pizza.id }],
        submit: true,
      });
      await draftOrder(tab.id, [{ productId: pizza.id, quantity: 3 }]);
      const detail = (await call('GET', `/tabs/${tab.id}`)).json<TabDetail>();
      expect(detail).toMatchObject({
        totalCents: 5000,
        draftCents: 15000,
        balanceCents: 5000,
        itemCount: 1,
      });
    });

    it('pedido enviado não aceita novos itens', async () => {
      const tab = await openTab();
      const order = (
        await call('POST', '/orders', {
          tabId: tab.id,
          channel: 'counter',
          items: [{ productId: pizza.id }],
          submit: true,
        })
      ).json<Order>();
      const res = await call('POST', `/orders/${order.id}/items`, {
        productId: pizza.id,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<ApiError>().code).toBe('ORDER_NOT_EDITABLE');
    });

    it('comanda fechada não aceita pedidos', async () => {
      const tab = await openTab();
      await pool.query(`update tabs set status = 'closed' where id = $1`, [
        tab.id,
      ]);
      const res = await call('POST', '/orders', {
        tabId: tab.id,
        channel: 'counter',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<ApiError>().code).toBe('TAB_NOT_OPEN');
    });
  });

  describe('cancelamento (RN05)', () => {
    it('cancela itens com motivo, sem apagar, e depois o pedido inteiro', async () => {
      const tab = await openTab();
      const order = (
        await call('POST', '/orders', {
          tabId: tab.id,
          channel: 'counter',
          items: [{ productId: pizza.id }, { productId: pizza.id }],
          submit: true,
        })
      ).json<Order>();

      const noReason = await call('POST', `/orders/${order.id}/cancellations`, {
        itemIds: [order.items[0].id],
      });
      expect(noReason.statusCode).toBe(422);

      const partial = (
        await call('POST', `/orders/${order.id}/cancellations`, {
          reason: 'cliente desistiu',
          itemIds: [order.items[0].id],
        })
      ).json<Order>();
      expect(partial.status).toBe('submitted');
      expect(partial.items).toHaveLength(2);
      expect(partial.items[0]).toMatchObject({
        status: 'canceled',
        cancelReason: 'cliente desistiu',
      });
      expect(partial.totalCents).toBe(5000);

      const again = await call('POST', `/orders/${order.id}/cancellations`, {
        reason: 'repetido',
        itemIds: [order.items[0].id],
      });
      expect(again.statusCode).toBe(422);

      const full = (
        await call('POST', `/orders/${order.id}/cancellations`, {
          reason: 'mesa foi embora',
        })
      ).json<Order>();
      expect(full).toMatchObject({
        status: 'canceled',
        cancelReason: 'mesa foi embora',
        totalCents: 0,
      });
      expect(full.items.every((i) => i.status === 'canceled')).toBe(true);

      const closed = await call('POST', `/orders/${order.id}/cancellations`, {
        reason: 'de novo',
      });
      expect(closed.statusCode).toBe(409);

      const detail = (await call('GET', `/tabs/${tab.id}`)).json<TabDetail>();
      expect(detail.totalCents).toBe(0);
      expect(detail.orders[0].items).toHaveLength(2);
    });
  });

  describe('concorrência (RNF04)', () => {
    it('itens adicionados ao mesmo tempo não se perdem', async () => {
      const tab = await openTab();
      const order = await draftOrder(tab.id);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          call('POST', `/orders/${order.id}/items`, { productId: pizza.id }),
        ),
      );
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      const final = (await call('GET', `/orders/${order.id}`)).json<Order>();
      expect(final.items).toHaveLength(8);
      expect(final.version).toBe(order.version + 8);
      expect(final.totalCents).toBe(40000);
    });
  });
});
