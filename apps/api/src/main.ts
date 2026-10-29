import { Logger } from '@nestjs/common';
import { API_PREFIX, createApp } from './app.factory.js';
import { lanAddresses } from './common/lan.js';
import { loadEnv } from './config/env.js';
import { runMigrations } from './db/migrator.js';
import { NetworkService } from './network/network.service.js';
import { DOCS_PATH } from './openapi/swagger.js';
import { findWebDir, serveWeb } from './web/serve-web.js';

async function bootstrap() {
  const env = loadEnv();
  const logger = new Logger('Bootstrap');
  if (env.MIGRATE_ON_START) {
    await runMigrations(env.DATABASE_URL);
    logger.log('Banco de dados atualizado.');
  }
  const app = await createApp();

  const webDir = findWebDir(env.WEB_DIR);
  if (webDir) {
    await serveWeb(app, webDir);
    logger.log(`App servido de ${webDir}`);
  } else {
    logger.warn(
      'Build do app não encontrado (rode "pnpm run build"); só a API está no ar.',
    );
  }

  await app.listen(env.PORT, env.HOST);

  // O primeiro IP é o que os celulares usam; os outros (VPN, WSL) só de referência.
  const [lan, ...others] = env.HOST === '0.0.0.0' ? lanAddresses() : [];
  const base = `http://${lan ?? 'localhost'}:${env.PORT}`;
  if (webDir) {
    logger.log(`Sistema (celulares e tablets): ${base}`);
    logger.log(`Cardápio do cliente: ${base}/cardapio`);
  }
  logger.log(`API: ${base}/${API_PREFIX}`);
  if (env.API_DOCS) logger.log(`Swagger: ${base}/${DOCS_PATH}`);
  if (others.length > 0) {
    logger.log(`Outros endereços desta máquina: ${others.join(', ')}`);
  }

  // Segue o IP sozinho se o roteador trocar (e avisa o dono para reimprimir).
  app.get(NetworkService).watch();
}
await bootstrap();
