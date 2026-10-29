import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';
import { findWebDir, serveWeb } from '../src/web/serve-web.js';

/** O app e o cardápio servidos pela mesma porta da API, como no restaurante. */
describe.skipIf(!process.env.DATABASE_URL)('Servidor do app (e2e)', () => {
  let app: NestFastifyApplication;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'muquifo-web-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><title>app</title>',
    );
    writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');

    app = await createApp({ logger: false });
    await serveWeb(app, root);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('abre o app na raiz e nas rotas do app (cardápio, comandas)', async () => {
    for (const url of ['/', '/cardapio?mesa=3', '/comandas/abc']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('<title>app</title>');
      // Sem cache: atualização do sistema chega no próximo acesso.
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('guarda em cache os arquivos com hash no nome', async () => {
    const res = await get('/assets/index-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect((await get('/assets/sumiu.js')).statusCode).toBe(404);
  });

  it('mantém a API e o 404 dela', async () => {
    expect((await get('/api/v1/health')).statusCode).toBe(200);
    const missing = await get('/api/v1/nao-existe');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('acha a pasta do build só quando tem index.html', () => {
    expect(findWebDir(root)).toBe(root);
    expect(findWebDir(join(root, 'assets'))).toBeNull();
  });
});
