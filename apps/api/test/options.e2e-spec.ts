import { randomUUID } from 'node:crypto';
import type {
  ApiError,
  Category,
  OptionGroup,
  Order,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './auth-helper.js';

/** Grupos de complementos: cadastro, herança por categoria e uso no pedido. */
describe.skipIf(!process.env.DATABASE_URL)('Complementos (e2e)', () => {
  let app: NestFastifyApplication;
  let category: Category;
  let burger: Product; // R$ 30,00
  let ponto: OptionGroup; // obrigatório, 1
  let adicionais: OptionGroup; // opcional, até 2
  let tab: TabDetail;

  const suffix = () => randomUUID().slice(0, 8);
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload,
      headers: { 'idempotency-key': randomUUID() },
    });
  const option = (g: OptionGroup, name: string) =>
    g.options.find((o) => o.name === name)!.id;
  const order = (items: object[], submit = false) =>
    call('POST', '/orders', {
      tabId: tab.id,
      channel: 'counter',
      submit,
      items,
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ponto = (
      await call('POST', '/option-groups', {
        name: `Ponto ${suffix()}`,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'Mal passado' },
          { name: 'Ao ponto' },
          { name: 'Bem passado' },
        ],
      })
    ).json<OptionGroup>();
    adicionais = (
      await call('POST', '/option-groups', {
        name: `Adicionais ${suffix()}`,
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: 'Bacon', priceCents: 400 },
          { name: 'Cheddar', priceCents: 300 },
          { name: 'Ovo', priceCents: 200 },
        ],
      })
    ).json<OptionGroup>();
    // Adicionais valem para a categoria inteira; o ponto só para o hambúrguer.
    category = (
      await call('POST', '/categories', {
        name: `Lanches ${suffix()}`,
        optionGroupIds: [adicionais.id],
      })
    ).json<Category>();
    burger = (
      await call('POST', '/products', {
        categoryId: category.id,
        name: `Burger ${suffix()}`,
        priceCents: 3000,
        optionGroupIds: [ponto.id],
      })
    ).json<Product>();
    tab = (await call('POST', '/tabs', {})).json<TabDetail>();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('cria grupo com opções na ordem e mostra onde está ligado', async () => {
    expect(ponto).toMatchObject({ minSelect: 1, maxSelect: 1, active: true });
    expect(ponto.options.map((o) => o.name)).toEqual([
      'Mal passado',
      'Ao ponto',
      'Bem passado',
    ]);
    const list = (await call('GET', '/option-groups')).json<OptionGroup[]>();
    expect(list.find((g) => g.id === adicionais.id)).toMatchObject({
      categoryCount: 1,
      productCount: 0,
    });
    expect(list.find((g) => g.id === ponto.id)?.productCount).toBe(1);
    expect(category.optionGroupIds).toEqual([adicionais.id]);
    expect(burger.optionGroupIds).toEqual([ponto.id]);
  });

  it('valida regras do grupo na criação', async () => {
    const bad = await call('POST', '/option-groups', {
      name: `Ruim ${suffix()}`,
      minSelect: 3,
      maxSelect: 2,
      options: [{ name: 'A' }, { name: 'a' }],
    });
    expect(bad.statusCode).toBe(422);
    const paths = bad.json<ApiError>().details as { path: string }[];
    expect(paths.map((p) => p.path).sort()).toEqual([
      'maxSelect',
      'options',
      'options',
    ]);
  });

  it('soma complementos no preço e grava o snapshot no item', async () => {
    const res = await order([
      {
        productId: burger.id,
        quantity: 2,
        optionIds: [
          option(adicionais, 'Bacon'),
          option(ponto, 'Ao ponto'),
          option(adicionais, 'Ovo'),
        ],
        expectedUnitPriceCents: 3600,
      },
    ]);
    expect(res.statusCode).toBe(201);
    const item = res.json<Order>().items[0];
    expect(item).toMatchObject({ unitPriceCents: 3600, totalCents: 7200 });
    // Ordem: grupos da categoria antes dos do produto, opções na ordem do grupo.
    expect(
      item.options.map((o) => [o.groupName, o.name, o.priceCents]),
    ).toEqual([
      [adicionais.name, 'Bacon', 400],
      [adicionais.name, 'Ovo', 200],
      [ponto.name, 'Ao ponto', 0],
    ]);
  });

  it('exige grupo obrigatório e respeita o máximo', async () => {
    const missing = await order([{ productId: burger.id }]);
    expect(missing.statusCode).toBe(422);
    expect(missing.json<ApiError>()).toMatchObject({
      code: 'INVALID_OPTIONS',
      details: { groupId: ponto.id, minSelect: 1, selected: 0 },
    });

    const tooMany = await order([
      {
        productId: burger.id,
        optionIds: [
          option(ponto, 'Ao ponto'),
          option(adicionais, 'Bacon'),
          option(adicionais, 'Cheddar'),
          option(adicionais, 'Ovo'),
        ],
      },
    ]);
    expect(tooMany.json<ApiError>()).toMatchObject({
      code: 'INVALID_OPTIONS',
      details: { groupId: adicionais.id, maxSelect: 2, selected: 3 },
    });
  });

  it('recusa opção de grupo não ligado ao produto', async () => {
    const other = (
      await call('POST', '/option-groups', {
        name: `Borda ${suffix()}`,
        options: [{ name: 'Catupiry', priceCents: 800 }],
      })
    ).json<OptionGroup>();
    const res = await order([
      {
        productId: burger.id,
        optionIds: [option(ponto, 'Ao ponto'), other.options[0].id],
      },
    ]);
    expect(res.json<ApiError>()).toMatchObject({
      code: 'INVALID_OPTIONS',
      details: { optionIds: [other.options[0].id] },
    });
  });

  it('opção em falta é recusada; preço exibido antigo dá PRICE_CHANGED', async () => {
    const current = (await call('GET', '/option-groups'))
      .json<OptionGroup[]>()
      .find((g) => g.id === adicionais.id)!;
    const edited = (
      await call('PATCH', `/option-groups/${adicionais.id}`, {
        version: current.version,
        options: current.options.map((o) => ({
          id: o.id,
          name: o.name,
          priceCents: o.name === 'Cheddar' ? 350 : o.priceCents,
          available: o.name !== 'Ovo',
        })),
      })
    ).json<OptionGroup>();
    expect(edited.version).toBe(current.version + 1);

    const ovo = await order([
      {
        productId: burger.id,
        optionIds: [option(ponto, 'Ao ponto'), option(edited, 'Ovo')],
      },
    ]);
    expect(ovo.statusCode).toBe(409);
    expect(ovo.json<ApiError>().code).toBe('OPTION_UNAVAILABLE');

    const stalePrice = await order([
      {
        productId: burger.id,
        optionIds: [option(ponto, 'Ao ponto'), option(edited, 'Cheddar')],
        expectedUnitPriceCents: 3300,
      },
    ]);
    expect(stalePrice.json<ApiError>()).toMatchObject({
      code: 'PRICE_CHANGED',
      details: { currentUnitPriceCents: 3350 },
    });

    const stale = await call('PATCH', `/option-groups/${adicionais.id}`, {
      version: current.version,
      name: 'Outro nome',
    });
    expect(stale.json<ApiError>().code).toBe('VERSION_CONFLICT');
  });

  it('opção removida da lista é arquivada e o pedido antigo mantém o snapshot', async () => {
    const sold = (
      await order(
        [{ productId: burger.id, optionIds: [option(ponto, 'Bem passado')] }],
        true,
      )
    ).json<Order>();
    const current = (await call('GET', '/option-groups'))
      .json<OptionGroup[]>()
      .find((g) => g.id === ponto.id)!;
    const edited = (
      await call('PATCH', `/option-groups/${ponto.id}`, {
        version: current.version,
        options: [
          ...current.options
            .filter((o) => o.name !== 'Bem passado')
            .map((o) => ({ id: o.id, name: o.name })),
          { name: 'Selado' },
        ],
      })
    ).json<OptionGroup>();
    expect(edited.options.map((o) => o.name)).toEqual([
      'Mal passado',
      'Ao ponto',
      'Selado',
    ]);

    const again = await order([
      { productId: burger.id, optionIds: [option(current, 'Bem passado')] },
    ]);
    expect(again.json<ApiError>().code).toBe('INVALID_OPTIONS');

    const kept = (await call('GET', `/orders/${sold.id}`)).json<Order>();
    expect(kept.items[0].options[0]).toMatchObject({ name: 'Bem passado' });
  });

  it('grupo arquivado deixa de valer; rascunho com complementos pode ser removido', async () => {
    const current = (await call('GET', '/option-groups'))
      .json<OptionGroup[]>()
      .find((g) => g.id === ponto.id)!;
    const draft = (
      await order([
        { productId: burger.id, optionIds: [option(current, 'Selado')] },
      ])
    ).json<Order>();
    const removed = await call(
      'DELETE',
      `/orders/${draft.id}/items/${draft.items[0].id}`,
    );
    expect(removed.statusCode).toBe(200);

    await call('PATCH', `/option-groups/${ponto.id}`, {
      version: current.version,
      active: false,
    });
    // Sem o ponto obrigatório, o hambúrguer sai só com os adicionais opcionais.
    const res = await order([{ productId: burger.id }]);
    expect(res.statusCode).toBe(201);
    expect(res.json<Order>().items[0].unitPriceCents).toBe(3000);
  });

  it('trocar grupos do produto incrementa a versão', async () => {
    const [p] = (await call('GET', `/products?categoryId=${category.id}`)).json<
      Product[]
    >();
    const res = await call('PATCH', `/products/${p.id}`, {
      version: p.version,
      optionGroupIds: [],
    });
    expect(res.json<Product>()).toMatchObject({
      optionGroupIds: [],
      version: p.version + 1,
    });
  });
});
