import { randomUUID } from 'node:crypto';
import type {
  ApiError,
  Category,
  OptionGroup,
  Order,
  PizzaFlavor,
  PizzaTier,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';

/** Pizzaria: tamanhos, faixas com preço por tamanho, sabores e borda. */
describe.skipIf(!process.env.DATABASE_URL)('Pizzaria (e2e)', () => {
  let app: NestFastifyApplication;
  let tab: TabDetail;
  let category: Category;
  let borda: OptionGroup;
  let broto: Product; // 1 sabor
  let grande: Product; // 3 sabores
  let tradicional: PizzaTier;
  let especial: PizzaTier; // sem preço na broto
  let calabresa: PizzaFlavor;
  let mussarela: PizzaFlavor;
  let camarao: PizzaFlavor;

  const tag = () => randomUUID().slice(0, 8);
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload,
      headers: { 'idempotency-key': randomUUID() },
    });
  const size = async (name: string, maxFlavors: number) =>
    (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `${name} ${tag()}`,
        priceCents: 0,
        maxFlavors,
      })
    ).json<Product>();
  const flavor = async (name: string, tier: PizzaTier) =>
    (
      await call('POST', '/pizza/flavors', {
        name: `${name} ${tag()}`,
        tierId: tier.id,
        description: 'molho, mussarela',
      })
    ).json<PizzaFlavor>();
  const order = (item: object) =>
    call('POST', '/orders', {
      tabId: tab.id,
      channel: 'counter',
      items: [item],
    });

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    borda = (
      await call('POST', '/option-groups', {
        name: `Borda ${tag()}`,
        options: [{ name: 'Catupiry', priceCents: 800 }],
      })
    ).json<OptionGroup>();
    category = (
      await call('POST', '/categories', {
        name: `Pizzas ${tag()}`,
        optionGroupIds: [borda.id],
      })
    ).json<Category>();
    broto = await size('Broto', 1);
    grande = await size('Grande', 3);
    tradicional = (
      await call('POST', '/pizza/tiers', {
        name: `Tradicional ${tag()}`,
        prices: [
          { productId: broto.id, priceCents: 3000 },
          { productId: grande.id, priceCents: 5500 },
        ],
      })
    ).json<PizzaTier>();
    especial = (
      await call('POST', '/pizza/tiers', {
        name: `Especial ${tag()}`,
        sortOrder: 1,
        prices: [{ productId: grande.id, priceCents: 7000 }],
      })
    ).json<PizzaTier>();
    [calabresa, mussarela, camarao] = await Promise.all([
      flavor('Calabresa', tradicional),
      flavor('Mussarela', tradicional),
      flavor('Camarão', especial),
    ]);
    tab = (await call('POST', '/tabs', {})).json<TabDetail>();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('faixa guarda o preço por tamanho e conta os sabores', async () => {
    expect(broto.maxFlavors).toBe(1);
    const tiers = (await call('GET', '/pizza/tiers')).json<PizzaTier[]>();
    const t = tiers.find((x) => x.id === tradicional.id)!;
    expect(t.flavorCount).toBe(2);
    expect(t.prices).toEqual(
      expect.arrayContaining([
        { productId: broto.id, priceCents: 3000 },
        { productId: grande.id, priceCents: 5500 },
      ]),
    );

    // Preço só para tamanho de pizza.
    const lanche = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `Lanche ${tag()}`,
        priceCents: 1000,
      })
    ).json<Product>();
    const bad = await call('PATCH', `/pizza/tiers/${tradicional.id}`, {
      prices: [{ productId: lanche.id, priceCents: 100 }],
    });
    expect(bad.statusCode).toBe(422);

    // Faixa com sabores ativos não arquiva.
    const archive = await call('PATCH', `/pizza/tiers/${especial.id}`, {
      active: false,
    });
    expect(archive.json<ApiError>().code).toBe('PIZZA_TIER_IN_USE');

    const dup = await call('POST', '/pizza/flavors', {
      name: calabresa.name.toUpperCase(),
      tierId: tradicional.id,
    });
    expect(dup.json<ApiError>()).toMatchObject({
      code: 'CONFLICT',
      details: { field: 'name' },
    });
  });

  it('meio a meio cobra a faixa mais cara e grava os sabores', async () => {
    const res = await order({
      productId: grande.id,
      flavorIds: [calabresa.id, camarao.id],
      optionIds: [borda.options[0].id],
      expectedUnitPriceCents: 7000 + 800,
    });
    expect(res.statusCode).toBe(201);
    const item = res.json<Order>().items[0];
    expect(item.unitPriceCents).toBe(7800);
    expect(item.flavors).toEqual([
      {
        flavorId: calabresa.id,
        name: calabresa.name,
        tierName: tradicional.name,
        priceCents: 5500,
      },
      {
        flavorId: camarao.id,
        name: camarao.name,
        tierName: especial.name,
        priceCents: 7000,
      },
    ]);
    expect(item.options.map((o) => o.priceCents)).toEqual([800]);

    // Mudar o preço da faixa não altera o item já lançado (RN02).
    await call('PATCH', `/pizza/tiers/${especial.id}`, {
      prices: [{ productId: grande.id, priceCents: 7500 }],
    });
    const tabNow = (await call('GET', `/tabs/${tab.id}`)).json<TabDetail>();
    const saved = tabNow.orders
      .flatMap((o) => o.items)
      .find((i) => i.id === item.id)!;
    expect(saved.flavors[1].priceCents).toBe(7000);
  });

  it('respeita o máximo de sabores e o preço por tamanho', async () => {
    const tooMany = await order({
      productId: broto.id,
      flavorIds: [calabresa.id, mussarela.id],
    });
    expect(tooMany.json<ApiError>()).toMatchObject({
      code: 'INVALID_FLAVORS',
      details: { maxFlavors: 1, selected: 2 },
    });

    const none = await order({ productId: grande.id });
    expect(none.json<ApiError>().code).toBe('INVALID_FLAVORS');

    // Especial não tem preço na broto: não sai nesse tamanho.
    const noPrice = await order({
      productId: broto.id,
      flavorIds: [camarao.id],
    });
    expect(noPrice.json<ApiError>()).toMatchObject({
      code: 'INVALID_FLAVORS',
      details: { flavorIds: [camarao.id] },
    });

    const ok = await order({ productId: broto.id, flavorIds: [mussarela.id] });
    expect(ok.json<Order>().items[0].unitPriceCents).toBe(3000);
  });

  it('sabor em falta é recusado e produto comum não aceita sabores', async () => {
    await call('PATCH', `/pizza/flavors/${mussarela.id}`, {
      available: false,
    });
    const out = await order({ productId: broto.id, flavorIds: [mussarela.id] });
    expect(out.statusCode).toBe(409);
    expect(out.json<ApiError>().code).toBe('FLAVOR_UNAVAILABLE');
    await call('PATCH', `/pizza/flavors/${mussarela.id}`, { available: true });

    const lanche = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `Pastel ${tag()}`,
        priceCents: 900,
      })
    ).json<Product>();
    const res = await order({
      productId: lanche.id,
      flavorIds: [calabresa.id],
    });
    expect(res.json<ApiError>().code).toBe('INVALID_FLAVORS');

    // Arquivado sai da lista ativa e do pedido.
    await call('PATCH', `/pizza/flavors/${calabresa.id}`, { active: false });
    const list = (await call('GET', '/pizza/flavors')).json<PizzaFlavor[]>();
    expect(list.some((f) => f.id === calabresa.id)).toBe(false);
    const gone = await order({
      productId: grande.id,
      flavorIds: [calabresa.id],
    });
    expect(gone.json<ApiError>().code).toBe('INVALID_FLAVORS');
  });
});
