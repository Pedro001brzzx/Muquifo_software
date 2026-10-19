import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AUTO_IDEMPOTENCY_KEY, openApiComponents } from './api-docs.js';

export const DOCS_PATH = 'docs';

const description = `
API do Muquifo para a rede local do restaurante.

- Dinheiro sempre em **centavos inteiros** (\`1250\` = R$ 12,50).
- Erros no formato \`{ code, message, details?, requestId }\`; o \`requestId\` também vem no header \`x-request-id\`.
- Alterações concorrentes enviam \`version\`; versão desatualizada retorna \`409 VERSION_CONFLICT\`.
- Mutações de comandas e pedidos exigem \`Idempotency-Key\`. Aqui no Swagger o valor \`${AUTO_IDEMPOTENCY_KEY}\` gera uma chave nova a cada envio.

**Atenção:** "Try it out" grava de verdade no banco configurado no \`.env\` da API.
`.trim();

/**
 * Roda no navegador (é serializado com toString), então não pode usar nada de fora.
 * Troca `auto` ou vazio por um UUID v4. Usa getRandomValues porque
 * crypto.randomUUID não existe em páginas HTTP abertas pelo IP da rede local.
 */
function requestInterceptor(req: { headers: Record<string, string> }) {
  const header = 'idempotency-key'; // IDEMPOTENCY_HEADER de @muquifo/contracts
  const current = req.headers[header];
  if (current === undefined) return req;
  if (current === '' || current === 'auto') {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    req.headers[header] =
      `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return req;
}

/** Swagger UI em /docs e o documento em /docs/json, servidos localmente (funciona offline). */
export function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Muquifo API')
    .setDescription(description)
    .setVersion('v1')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ...openApiComponents() },
  };

  SwaggerModule.setup(DOCS_PATH, app, document, {
    customSiteTitle: 'Muquifo API',
    jsonDocumentUrl: `${DOCS_PATH}/json`,
    swaggerOptions: {
      tryItOutEnabled: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      requestInterceptor,
    },
  });
}
