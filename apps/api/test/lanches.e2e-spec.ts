import { randomUUID } from 'node:crypto';
import type {
  ApiError,
  Category,
  Ingredient,
  OptionGroup,
  Order,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';

/** Montagem de lanches: ingredientes, ajustes, grupo desligado e combo com bebida. */
describe.skipIf(!process.env.DATABASE_URL)('Lanches (e2e)', () => {
  let app: NestFastifyApplication;
  let tab: TabDetail;
  let pao: Ingredient;
  let frango: Ingredient;
  let alface: Ingredient;
  let tomate: Ingredient;
  let bebida: OptionGroup; // filho: obrigatório 1
  let combo: OptionGroup; // opcional 1; "Combo" abre "Bebida"
  let category: Category;

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
  const ingredient = async (name: string) =>
    (
      await call('POST', '/ingredients', { name: `${name} ${tag()}` })
    ).json<Ingredient>();
  const opt = (g: OptionGroup, name: string) =>
    g.options.find((o) => o.name === name)!.id;
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
    [pao, frango, alface, tomate] = await Promise.all(
      ['Pão', 'Frango', 'Alface', 'Tomate'].map(ingredient),
    );
    bebida = (
      await call('POST', '/option-groups', {
        name: `Bebida ${tag()}`,
        minSelect: 1,
        maxSelect: 1,
        options: [{ name: 'Coca' }, { name: 'Suco', priceCents: 200 }],
      })
    ).json<OptionGroup>();
    combo = (
      await call('POST', '/option-groups', {
        name: `Vira combo ${tag()}`,
        options: [
          { name: 'Combo', priceCents: 1500, childGroupId: bebida.id },
          { name: 'Só batata', priceCents: 900 },
        ],
      })
    ).json<OptionGroup>();
    category = (
      await call('POST', '/categories', {
        name: `Lanches ${tag()}`,
        optionGroupIds: [combo.id],
      })
    ).json<Category>();
    tab = (await call('POST', '/tabs', {})).json<TabDetail>();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('biblioteca: nome único sem diferenciar maiúsculas, arquiva e conta uso', async () => {
    const dup = await call('POST', '/ingredients', {
      name: pao.name.toUpperCase(),
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<ApiError>().details).toEqual({ field: 'name' });

    const extra = await ingredient('Picles');
    const archived = (
      await call('PATCH', `/ingredients/${extra.id}`, { active: false })
    ).json<Ingredient>();
    expect(archived.active).toBe(false);
    const active = (await call('GET', '/ingredients')).json<Ingredient[]>();
    expect(active.some((i) => i.id === extra.id)).toBe(false);
  });

  it('produto guarda a receita na ordem e desliga grupo herdado', async () => {
    const product = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `X-Frango ${tag()}`,
        priceCents: 2900,
        icon: '🍔',
        ingredients: [
          { ingredientId: pao.id, adjustable: false },
          { ingredientId: frango.id, adjustable: false },
          { ingredientId: alface.id },
          { ingredientId: tomate.id },
        ],
        excludedOptionGroupIds: [combo.id],
      })
    ).json<Product>();
    expect(
      product.ingredients.map((i) => [i.ingredientId, i.adjustable]),
    ).toEqual([
      [pao.id, false],
      [frango.id, false],
      [alface.id, true],
      [tomate.id, true],
    ]);
    expect(product.excludedOptionGroupIds).toEqual([combo.id]);
    expect(product.icon).toBe('🍔');

    const library = (await call('GET', '/ingredients')).json<Ingredient[]>();
    expect(library.find((i) => i.id === frango.id)?.productCount).toBe(1);

    // Combo desligado neste produto: opção do combo é recusada.
    const res = await order({
      productId: product.id,
      optionIds: [opt(combo, 'Só batata')],
    });
    expect(res.json<ApiError>().code).toBe('INVALID_OPTIONS');

    // Reativar o combo trocando só a lista de desligados.
    const edited = (
      await call('PATCH', `/products/${product.id}`, {
        version: product.version,
        excludedOptionGroupIds: [],
      })
    ).json<Product>();
    expect(edited.excludedOptionGroupIds).toEqual([]);
    expect(edited.ingredients).toHaveLength(4);
  });

  it('grava Sem/Pouco/Extra só em ingrediente ajustável', async () => {
    const product = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `X-Salada ${tag()}`,
        priceCents: 2500,
        ingredients: [
          { ingredientId: pao.id, adjustable: false },
          { ingredientId: alface.id },
          { ingredientId: tomate.id },
        ],
      })
    ).json<Product>();

    const ok = await order({
      productId: product.id,
      adjustments: [
        { ingredientId: tomate.id, kind: 'remove' },
        { ingredientId: alface.id, kind: 'extra' },
      ],
    });
    expect(ok.statusCode).toBe(201);
    const item = ok.json<Order>().items[0];
    // Ordem da receita, nome do momento da venda, sem custo.
    expect(item.adjustments.map((a) => [a.name, a.kind])).toEqual([
      [alface.name, 'extra'],
      [tomate.name, 'remove'],
    ]);
    expect(item.unitPriceCents).toBe(2500);

    const fixed = await order({
      productId: product.id,
      adjustments: [{ ingredientId: pao.id, kind: 'remove' }],
    });
    expect(fixed.json<ApiError>()).toMatchObject({
      code: 'INVALID_ADJUSTMENTS',
      details: { ingredientIds: [pao.id] },
    });
    const foreign = await order({
      productId: product.id,
      adjustments: [{ ingredientId: frango.id, kind: 'less' }],
    });
    expect(foreign.json<ApiError>().code).toBe('INVALID_ADJUSTMENTS');
  });

  it('combo com bebida: grupo filho só é exigido se o combo for escolhido', async () => {
    const product = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `X-Burger ${tag()}`,
        priceCents: 3000,
      })
    ).json<Product>();

    const plain = await order({ productId: product.id });
    expect(plain.statusCode).toBe(201);

    const noDrink = await order({
      productId: product.id,
      optionIds: [opt(combo, 'Combo')],
    });
    expect(noDrink.json<ApiError>()).toMatchObject({
      code: 'INVALID_OPTIONS',
      details: { groupId: bebida.id, minSelect: 1, selected: 0 },
    });

    const withDrink = await order({
      productId: product.id,
      optionIds: [opt(bebida, 'Suco'), opt(combo, 'Combo')],
    });
    expect(withDrink.statusCode).toBe(201);
    const item = withDrink.json<Order>().items[0];
    expect(item.unitPriceCents).toBe(3000 + 1500 + 200);
    // Pai antes do filho.
    expect(item.options.map((o) => o.name)).toEqual(['Combo', 'Suco']);

    // Bebida sem combo: o grupo filho não está ativo.
    const orphan = await order({
      productId: product.id,
      optionIds: [opt(bebida, 'Coca')],
    });
    expect(orphan.json<ApiError>().code).toBe('INVALID_OPTIONS');
  });

  it('grupo filho valida existência e não aponta para si mesmo', async () => {
    const self = await call('PATCH', `/option-groups/${bebida.id}`, {
      version: bebida.version,
      options: bebida.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceCents: o.priceCents,
        childGroupId: bebida.id,
      })),
    });
    expect(self.statusCode).toBe(422);

    const missing = await call('POST', '/option-groups', {
      name: `Ruim ${tag()}`,
      options: [{ name: 'X', childGroupId: randomUUID() }],
    });
    expect(missing.statusCode).toBe(422);
  });
});
