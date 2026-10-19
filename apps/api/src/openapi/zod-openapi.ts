import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

const SAFE_INT = Number.MAX_SAFE_INTEGER;

/** Remove detalhes que só poluem a documentação (regex de UUID/data, limites de inteiro seguro). */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    out[key] = tidy(value);
  }
  if (typeof out.format === 'string') delete out.pattern;
  if (out.minimum === -SAFE_INT) delete out.minimum;
  if (out.maximum === SAFE_INT) delete out.maximum;
  return out;
}

/**
 * Converte um schema de @muquifo/contracts em JSON Schema OpenAPI 3.0.
 * `input` descreve o que o cliente envia (campos com default são opcionais);
 * `output` descreve o que a API devolve.
 */
export function toOpenApi(
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): SchemaObject {
  return tidy(
    z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io,
      unrepresentable: 'any',
    }),
  ) as SchemaObject;
}
