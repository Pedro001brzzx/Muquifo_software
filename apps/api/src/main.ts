import { networkInterfaces } from 'node:os';
import { Logger } from '@nestjs/common';
import { API_PREFIX, createApp } from './app.factory.js';
import { loadEnv } from './config/env.js';
import { DOCS_PATH } from './openapi/swagger.js';

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
}

async function bootstrap() {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.PORT, env.HOST);

  const logger = new Logger('Bootstrap');
  logger.log(`API em http://localhost:${env.PORT}/${API_PREFIX}`);
  if (env.API_DOCS) {
    logger.log(`Swagger em http://localhost:${env.PORT}/${DOCS_PATH}`);
  }
  if (env.HOST === '0.0.0.0') {
    for (const ip of lanAddresses()) {
      logger.log(`Na rede local: http://${ip}:${env.PORT}/${API_PREFIX}`);
      if (env.API_DOCS) {
        logger.log(`Swagger na rede: http://${ip}:${env.PORT}/${DOCS_PATH}`);
      }
    }
  }
}
await bootstrap();
