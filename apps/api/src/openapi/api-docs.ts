import { apiErrorSchema, IDEMPOTENCY_HEADER } from '@muquifo/contracts';
import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiParam,
  ApiQuery,
  ApiResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { toOpenApi } from './zod-openapi.js';

// Schemas de resposta viram componentes nomeados (seção "Schemas" do Swagger UI).
const components = new Map<string, SchemaObject>();

export function openApiComponents(): Record<string, SchemaObject> {
  return Object.fromEntries(components);
}

function ref(name: string, schema: z.ZodType) {
  if (!components.has(name)) components.set(name, toOpenApi(schema, 'output'));
  return { $ref: `#/components/schemas/${name}` };
}

/** Valor de exemplo que o Swagger UI troca por um UUID novo a cada envio. */
export const AUTO_IDEMPOTENCY_KEY = 'auto';

/** Erros por status HTTP; cada linha costuma ser "`CODIGO` — quando acontece". */
export type ErrorDocs = Partial<Record<number, string | string[]>>;

const lines = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

export function ApiErrors(errors: ErrorDocs) {
  const schema = ref('ApiError', apiErrorSchema);
  return applyDecorators(
    ...Object.entries(errors).map(([status, description]) =>
      ApiResponse({
        status: Number(status),
        description: lines(description).join('\n\n'),
        schema,
      }),
    ),
  );
}

export function ApiZodBody(schema: z.ZodType, description?: string) {
  return ApiBody({ schema: toOpenApi(schema, 'input'), description });
}

/** Um parâmetro de query por propriedade do schema. */
export function ApiZodQuery(schema: z.ZodObject) {
  const json = toOpenApi(schema, 'input');
  const required = new Set(json.required ?? []);
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) =>
      ApiQuery({
        name,
        required: required.has(name),
        schema: property as SchemaObject,
      }),
    ),
  );
}

export function ApiUuidParam(name: string, description: string) {
  return ApiParam({
    name,
    description,
    schema: { type: 'string', format: 'uuid' },
  });
}

interface SuccessDoc {
  status: number;
  /** Nome do componente em "Schemas". */
  name: string;
  schema: z.ZodType;
  description?: string;
  isArray?: boolean;
}

function successResponse(doc: SuccessDoc, extra: object = {}) {
  const target = ref(doc.name, doc.schema);
  return ApiResponse({
    status: doc.status,
    description: doc.description ?? 'Sucesso.',
    schema: doc.isArray ? { type: 'array', items: target } : target,
    ...extra,
  });
}

export function ApiZodResponse(doc: SuccessDoc) {
  return successResponse(doc);
}

/**
 * Mutação com Idempotency-Key (RNF03): documenta o header, o header de replay
 * na resposta e os erros de chave junto com os erros próprios da rota.
 */
export function ApiIdempotent(success: SuccessDoc, errors: ErrorDocs = {}) {
  const merged: ErrorDocs = { ...errors };
  merged[400] = [
    '`IDEMPOTENCY_KEY_REQUIRED` — header ausente ou não é um UUID.',
    ...lines(errors[400]),
  ];
  merged[422] = [
    '`VALIDATION_FAILED` — corpo inválido; `details` lista cada campo.',
    '`IDEMPOTENCY_KEY_REUSED` — a chave já foi usada com outro conteúdo.',
    ...lines(errors[422]),
  ];
  return applyDecorators(
    ApiHeader({
      name: IDEMPOTENCY_HEADER,
      required: true,
      description: [
        'UUID novo por operação. Reenviar a mesma chave com o mesmo conteúdo',
        'devolve o resultado original sem repetir a operação.',
        `No Swagger UI, deixe \`${AUTO_IDEMPOTENCY_KEY}\` para gerar uma chave a cada envio,`,
        'ou cole um UUID fixo para testar o reenvio.',
      ].join(' '),
      schema: { type: 'string', example: AUTO_IDEMPOTENCY_KEY },
    }),
    successResponse(success, {
      headers: {
        'Idempotent-Replayed': {
          description:
            '`true` quando a resposta é o resultado gravado de um envio anterior.',
          schema: { type: 'string', enum: ['true'] },
        },
      },
    }),
    ApiErrors(merged),
  );
}
