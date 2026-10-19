import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject, ParameterObject } from '@nestjs/swagger';
import { createApp } from '../src/app.factory.js';

describe.skipIf(!process.env.DATABASE_URL)('Swagger (e2e)', () => {
  let app: NestFastifyApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
  });

  afterAll(async () => {
    await app?.close();
  });

  const params = (path: string, method: string) =>
    (doc.paths[path]?.[method as 'get']?.parameters ?? []) as ParameterObject[];

  it('serve a interface e o documento', async () => {
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');

    const init = await app.inject({
      method: 'GET',
      url: '/docs/swagger-ui-init.js',
    });
    expect(init.statusCode).toBe(200);
    // O interceptor que gera Idempotency-Key precisa chegar ao navegador.
    expect(init.body).toContain('requestInterceptor');
    expect(init.body).toContain('getRandomValues');

    expect(doc.openapi).toMatch(/^3\./);
  });

  it('documenta todas as rotas com o prefixo /api/v1', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/categories',
      '/api/v1/health',
      '/api/v1/operations/{operationId}',
      '/api/v1/orders',
      '/api/v1/orders/{id}',
      '/api/v1/orders/{id}/cancellations',
      '/api/v1/orders/{id}/items',
      '/api/v1/orders/{id}/items/{itemId}',
      '/api/v1/orders/{id}/submit',
      '/api/v1/products',
      '/api/v1/products/{id}/availability',
      '/api/v1/sectors',
      '/api/v1/tables',
      '/api/v1/tabs',
      '/api/v1/tabs/{id}',
      '/api/v1/tabs/{id}/cancellations',
      '/api/v1/tabs/{id}/close',
      '/api/v1/tabs/{id}/payments',
      '/api/v1/tabs/{id}/payments/{paymentId}/cancellations',
    ]);
  });

  it('gera corpo e resposta a partir dos schemas Zod', () => {
    const create = doc.paths['/api/v1/orders'].post!;
    const body = (create.requestBody as { content: Record<string, any> })
      .content['application/json'].schema;
    expect(body.required).toEqual(['tabId', 'channel']);
    expect(body.properties.channel.enum).toEqual([
      'table',
      'counter',
      'pickup',
      'delivery',
    ]);
    expect(body.properties.tabId).toEqual({ type: 'string', format: 'uuid' });

    const created = create.responses['201'] as { content: Record<string, any> };
    expect(created.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Order',
    });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Order', 'TabDetail', 'ApiError', 'Product']),
    );
  });

  it('exige Idempotency-Key só nas mutações de comandas e pedidos', () => {
    const header = (path: string, method: string) =>
      params(path, method).filter(
        (p) => p.in === 'header' && p.name === 'idempotency-key',
      );

    for (const [path, method] of [
      ['/api/v1/tabs', 'post'],
      ['/api/v1/orders', 'post'],
      ['/api/v1/orders/{id}/items', 'post'],
      ['/api/v1/orders/{id}/items/{itemId}', 'delete'],
      ['/api/v1/orders/{id}/submit', 'post'],
      ['/api/v1/orders/{id}/cancellations', 'post'],
      ['/api/v1/tabs/{id}/payments', 'post'],
      ['/api/v1/tabs/{id}/payments/{paymentId}/cancellations', 'post'],
      ['/api/v1/tabs/{id}/close', 'post'],
      ['/api/v1/tabs/{id}/cancellations', 'post'],
    ]) {
      expect(header(path, method), `${method} ${path}`).toHaveLength(1);
      expect(header(path, method)[0].required).toBe(true);
    }
    expect(header('/api/v1/tabs', 'get')).toHaveLength(0);
    expect(header('/api/v1/products', 'post')).toHaveLength(0);
  });

  it('documenta filtros de query e parâmetros de rota', () => {
    expect(
      params('/api/v1/tabs', 'get').map((p) => [p.in, p.name, p.required]),
    ).toEqual([
      ['query', 'status', false],
      ['query', 'tableId', false],
    ]);
    expect(
      params('/api/v1/orders/{id}/items/{itemId}', 'delete')
        .filter((p) => p.in === 'path')
        .map((p) => p.name)
        .sort(),
    ).toEqual(['id', 'itemId']);
  });
});
