import { randomUUID } from 'node:crypto';
import type {
  ApiError,
  Category,
  Order,
  Product,
  TabDetail,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './auth-helper.js';

/** Cadastro de produtos e categorias pela administração. */
describe.skipIf(!process.env.DATABASE_URL)('Cadastro de produtos (e2e)', () => {
  let app: NestFastifyApplication;

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
  const newCategory = async (prefix = 'Cat') =>
    (
      await call('POST', '/categories', {
        name: `${prefix} ${randomUUID().slice(0, 8)}`,
      })
    ).json<Category>();
  const newProduct = async (categoryId: string, extra: object = {}) =>
    (
      await call('POST', '/products', {
        categoryId,
        name: `Produto ${randomUUID().slice(0, 8)}`,
        priceCents: 1000,
        ...extra,
      })
    ).json<Product>();

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('código é opcional, normalizado em maiúsculas e único', async () => {
    const category = await newCategory();
    const code = `x${randomUUID().slice(0, 6)}`;
    const product = await newProduct(category.id, { code });
    expect(product).toMatchObject({
      code: code.toUpperCase(),
      active: true,
      available: true,
      updatedAt: expect.any(String),
    });

    const dup = await call('POST', '/products', {
      categoryId: category.id,
      name: 'Outro nome',
      priceCents: 500,
      code,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<ApiError>()).toMatchObject({
      code: 'CONFLICT',
      details: { field: 'code' },
    });

    const sameName = await call('POST', '/products', {
      categoryId: category.id,
      name: product.name,
      priceCents: 500,
    });
    expect(sameName.json<ApiError>().details).toEqual({ field: 'name' });

    const bad = await call('POST', '/products', {
      categoryId: category.id,
      name: 'Código ruim',
      priceCents: 500,
      code: 'com espaço',
    });
    expect(bad.statusCode).toBe(422);
  });

  it('edita campos com version; versão antiga é recusada', async () => {
    const category = await newCategory();
    const other = await newCategory();
    const product = await newProduct(category.id);

    const edited = await call('PATCH', `/products/${product.id}`, {
      version: product.version,
      name: 'Pudim de leite',
      priceCents: 1450,
      categoryId: other.id,
      description: 'Fatia',
      allowFractional: true,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<Product>()).toMatchObject({
      name: 'Pudim de leite',
      priceCents: 1450,
      categoryId: other.id,
      description: 'Fatia',
      allowFractional: true,
      version: product.version + 1,
    });

    const stale = await call('PATCH', `/products/${product.id}`, {
      version: product.version,
      priceCents: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiError>()).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: product.version + 1 },
    });

    const empty = await call('PATCH', `/products/${product.id}`, {
      version: product.version + 1,
    });
    expect(empty.statusCode).toBe(422);
  });

  it('arquivado sai do cardápio e não pode ser vendido; restaurar devolve', async () => {
    const category = await newCategory();
    const product = await newProduct(category.id);
    const archived = (
      await call('PATCH', `/products/${product.id}`, {
        version: product.version,
        active: false,
      })
    ).json<Product>();
    expect(archived.active).toBe(false);

    const ids = async (status?: string) =>
      (
        await call(
          'GET',
          `/products?categoryId=${category.id}${status ? `&status=${status}` : ''}`,
        )
      )
        .json<Product[]>()
        .map((p) => p.id);
    expect(await ids()).not.toContain(product.id);
    expect(await ids('archived')).toContain(product.id);
    expect(await ids('all')).toContain(product.id);

    const tab = (await call('POST', '/tabs', {})).json<TabDetail>();
    const sell = await call('POST', '/orders', {
      tabId: tab.id,
      channel: 'counter',
      items: [{ productId: product.id }],
    });
    expect(sell.statusCode).toBe(409);
    expect(sell.json<ApiError>()).toMatchObject({
      code: 'PRODUCT_UNAVAILABLE',
      message: expect.stringContaining('saiu do cardápio'),
    });

    await call('PATCH', `/products/${product.id}`, {
      version: archived.version,
      active: true,
    });
    const order = await call('POST', '/orders', {
      tabId: tab.id,
      channel: 'counter',
      items: [{ productId: product.id }],
    });
    expect(order.statusCode).toBe(201);
    expect(order.json<Order>().items).toHaveLength(1);
  });

  it('categoria com produto ativo não é arquivada; arquivada não recebe produto', async () => {
    const category = await newCategory('Arq');
    const target = await newCategory();
    const product = await newProduct(category.id);

    const blocked = await call('PATCH', `/categories/${category.id}`, {
      active: false,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<ApiError>()).toMatchObject({
      code: 'CATEGORY_IN_USE',
      details: { activeProducts: 1 },
    });

    await call('PATCH', `/products/${product.id}`, {
      version: product.version,
      categoryId: target.id,
    });
    const renamed = await call('PATCH', `/categories/${category.id}`, {
      active: false,
      name: `${category.name} (antiga)`,
      sortOrder: 9,
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<Category>()).toMatchObject({
      active: false,
      sortOrder: 9,
    });

    const into = await call('POST', '/products', {
      categoryId: category.id,
      name: 'Na arquivada',
      priceCents: 100,
    });
    expect(into.json<ApiError>().code).toBe('CATEGORY_ARCHIVED');
  });
});
