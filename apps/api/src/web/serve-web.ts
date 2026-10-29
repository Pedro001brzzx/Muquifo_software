import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { API_PREFIX } from '../app.factory.js';
import { DOCS_PATH } from '../openapi/swagger.js';

/**
 * Pasta do build do app (apps/web/dist). WEB_DIR vale quando o instalador
 * coloca os arquivos em outro lugar; senão procura ao lado da API no monorepo.
 */
export function findWebDir(configured?: string): string | null {
  const candidates = configured
    ? [resolve(configured)]
    : [
        resolve(process.cwd(), '../web/dist'),
        // dist/web/serve-web.js (ou src/web/serve-web.ts) → apps/web/dist
        fileURLToPath(new URL('../../../web/dist', import.meta.url)),
      ];
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? null;
}

/**
 * Serve o app pela mesma porta da API: celulares abrem http://IP:3000 e o
 * cardápio do cliente em /cardapio, sem servidor separado. Rotas do app
 * (/comandas, /cardapio...) devolvem o index.html; /api e /docs seguem com o
 * 404 da API.
 */
export async function serveWeb(app: NestFastifyApplication, root: string) {
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    // Arquivos conhecidos no início; o resto cai no index.html abaixo.
    wildcard: false,
    // Na v10 o primeiro argumento é o reply do Fastify, não o res do Node.
    setHeaders: (res, path) => {
      // Arquivos de /assets têm hash no nome: podem ficar em cache para sempre.
      // O index.html não, para a atualização chegar no próximo acesso.
      (res as unknown as FastifyReply).header(
        'cache-control',
        /[\\/]assets[\\/]/.test(path)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });

  // Arquivo de /assets que não existe é 404, não a página do app.
  const reserved = [
    `/${API_PREFIX.split('/')[0]}/`,
    `/${DOCS_PATH}`,
    '/assets/',
  ];
  app
    .getHttpAdapter()
    .getInstance()
    .get('/*', (request, reply) => {
      if (reserved.some((p) => request.url.startsWith(p))) {
        return reply.callNotFound();
      }
      return reply
        .header('cache-control', 'no-cache')
        .sendFile('index.html', root);
    });
}
