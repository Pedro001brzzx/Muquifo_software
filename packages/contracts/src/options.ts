import { z } from 'zod';
import { centsSchema } from './money.js';

/**
 * Grupos de complementos reutilizáveis ("Ponto da carne", "Adicionais", "Borda").
 * Criados uma vez e ligados a produtos ou a categorias inteiras.
 */

const nameSchema = z.string().trim().min(1).max(80);

export const optionSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  name: z.string(),
  /** Acréscimo no preço do item (0 = sem custo). */
  priceCents: centsSchema,
  /** Esgotado no momento. */
  available: z.boolean(),
  sortOrder: z.number().int(),
  /** Grupo que passa a valer quando esta opção é escolhida (ex.: Combo → Bebida do combo). */
  childGroupId: z.uuid().nullable(),
});
export type Option = z.infer<typeof optionSchema>;

export const optionGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** 0 = opcional; 1 ou mais = obrigatório escolher ao menos isso. */
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
  /** Só as opções ativas, na ordem de exibição. */
  options: z.array(optionSchema),
  /** Onde o grupo está ligado (para mostrar o alcance na administração). */
  productCount: z.number().int(),
  categoryCount: z.number().int(),
});
export type OptionGroup = z.infer<typeof optionGroupSchema>;

/** Opção no formulário do grupo: com `id` altera a existente, sem `id` cria. */
const optionInputSchema = z.object({
  id: z.uuid().optional(),
  name: nameSchema,
  priceCents: centsSchema.default(0),
  available: z.boolean().default(true),
  childGroupId: z.uuid().nullable().default(null),
});

/** Regras que valem na criação e na edição (com os campos que vierem). */
function checkSelection(
  g: {
    minSelect?: number;
    maxSelect?: number;
    options?: { name: string }[];
  },
  ctx: z.RefinementCtx,
) {
  if (
    g.minSelect !== undefined &&
    g.maxSelect !== undefined &&
    g.maxSelect < g.minSelect
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'O máximo não pode ser menor que o mínimo.',
      path: ['maxSelect'],
    });
  }
  if (
    g.options &&
    g.minSelect !== undefined &&
    g.options.length < g.minSelect
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Há menos opções do que o mínimo exigido.',
      path: ['options'],
    });
  }
  if (g.options) {
    const names = g.options.map((o) => o.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Há opções com o mesmo nome.',
        path: ['options'],
      });
    }
  }
}

export const createOptionGroupSchema = z
  .object({
    name: nameSchema,
    minSelect: z.number().int().min(0).max(20).default(0),
    maxSelect: z.number().int().min(1).max(20).default(1),
    options: z.array(optionInputSchema).min(1).max(50),
  })
  .superRefine(checkSelection);
export type CreateOptionGroupInput = z.input<typeof createOptionGroupSchema>;

/**
 * Edição com `version`. `options`, se enviado, é a lista completa: opções que
 * ficarem de fora são arquivadas (seguem nos pedidos antigos).
 */
export const updateOptionGroupSchema = z
  .object({
    version: z.number().int().positive(),
    name: nameSchema.optional(),
    minSelect: z.number().int().min(0).max(20).optional(),
    maxSelect: z.number().int().min(1).max(20).optional(),
    active: z.boolean().optional(),
    options: z.array(optionInputSchema).min(1).max(50).optional(),
  })
  .superRefine(checkSelection);
export type UpdateOptionGroupInput = z.input<typeof updateOptionGroupSchema>;

export const listOptionGroupsQuerySchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

/** Complemento escolhido, gravado no item do pedido como foi vendido (RN02). */
export const orderItemOptionSchema = z.object({
  optionId: z.uuid(),
  groupName: z.string(),
  name: z.string(),
  priceCents: centsSchema,
});
export type OrderItemOption = z.infer<typeof orderItemOptionSchema>;

/** Lista de grupos ligada a produto ou categoria, na ordem de exibição. */
export const optionGroupIdsSchema = z
  .array(z.uuid())
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Grupo repetido.');
