import { randomUUID } from 'node:crypto';
import type { ApiError, Category, Health, Product } from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';

/**
 * Requer um PostgreSQL com as migrations aplicadas (pnpm db:migrate).
 * Os dados criados usam nomes únicos para não colidir com o seed.
 */
describe.skipIf(!process.env.DATABASE_URL)('API (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const inject = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
  ) => app.inject({ method, url: `/api/v1${url}`, payload });

  it('GET /health informa banco disponível', async () => {
    const res = await inject('GET', '/health');
    expect(res.statusCode).toBe(200);
    expect(res.json<Health>()).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('cria categoria e produto, e aplica concorrência otimista', async () => {
    const suffix = randomUUID().slice(0, 8);
    const category = (
      await inject('POST', '/categories', { name: `Teste ${suffix}` })
    ).json<Category>();

    const created = await inject('POST', '/products', {
      categoryId: category.id,
      name: `Produto ${suffix}`,
      priceCents: 1990,
    });
    expect(created.statusCode).toBe(201);
    const product = created.json<Product>();
    expect(product).toMatchObject({
      priceCents: 1990,
      available: true,
      version: 1,
    });

    const updated = await inject(
      'PATCH',
      `/products/${product.id}/availability`,
      {
        available: false,
        version: 1,
      },
    );
    expect(updated.json<Product>()).toMatchObject({
      available: false,
      version: 2,
    });

    const stale = await inject(
      'PATCH',
      `/products/${product.id}/availability`,
      {
        available: true,
        version: 1,
      },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiError>()).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
  });

  it('nome de categoria duplicado retorna 409', async () => {
    const name = `Dup ${randomUUID().slice(0, 8)}`;
    await inject('POST', '/categories', { name });
    const res = await inject('POST', '/categories', { name });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().code).toBe('CONFLICT');
  });

  it('produto com categoria inexistente retorna 422', async () => {
    const res = await inject('POST', '/products', {
      categoryId: randomUUID(),
      name: 'Órfão',
      priceCents: 100,
    });
    expect(res.statusCode).toBe(422);
  });

  it('rota inexistente usa o formato de erro padrão', async () => {
    const res = await inject('GET', '/nao-existe');
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>()).toMatchObject({
      code: 'NOT_FOUND',
      requestId: expect.any(String),
    });
  });
});
