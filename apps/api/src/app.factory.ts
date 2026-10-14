import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { loadEnv } from './config/env.js';

export const API_PREFIX = 'api/v1';

/** Monta a aplicação com a mesma configuração no servidor e nos testes e2e. */
export async function createApp(
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
  const env = loadEnv();
  const adapter = new FastifyAdapter({ genReqId: () => randomUUID() });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      logger: options.logger === false ? false : undefined,
    },
  );

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin:
      env.CORS_ORIGINS === '*'
        ? true
        : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      void reply.header('x-request-id', request.id);
    });

  return app;
}
