import { z } from 'zod';

/**
 * Biblioteca de ingredientes, reaproveitada na montagem dos lanches.
 * No produto, cada ingrediente é fixo (pão, carne) ou ajustável: o cliente
 * pode pedir Sem, Pouco ou Extra (sem custo; extra pago vai em Adicionais).
 */

const nameSchema = z.string().trim().min(1).max(60);

export const ingredientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  /** Em quantos produtos ativos aparece. */
  productCount: z.number().int(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const createIngredientSchema = z.object({ name: nameSchema });
export type CreateIngredientInput = z.input<typeof createIngredientSchema>;

export const updateIngredientSchema = z
  .object({
    name: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, {
    message: 'Informe ao menos um campo.',
  });
export type UpdateIngredientInput = z.input<typeof updateIngredientSchema>;

export const listIngredientsQuerySchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

/** Ingrediente dentro de um produto, na ordem da receita. */
export const productIngredientSchema = z.object({
  ingredientId: z.uuid(),
  name: z.string(),
  /** Falso = fixo (não aparece para ajuste). */
  adjustable: z.boolean(),
});
export type ProductIngredient = z.infer<typeof productIngredientSchema>;

export const productIngredientInputSchema = z.object({
  ingredientId: z.uuid(),
  adjustable: z.boolean().default(true),
});

export const productIngredientsInputSchema = z
  .array(productIngredientInputSchema)
  .max(30)
  .refine(
    (list) => new Set(list.map((i) => i.ingredientId)).size === list.length,
    'Ingrediente repetido.',
  );

export const adjustmentKindSchema = z.enum(['remove', 'less', 'extra']);
export type AdjustmentKind = z.infer<typeof adjustmentKindSchema>;

export const adjustmentKindLabel: Record<AdjustmentKind, string> = {
  remove: 'Sem',
  less: 'Pouco',
  extra: 'Extra',
};

export const adjustmentInputSchema = z.object({
  ingredientId: z.uuid(),
  kind: adjustmentKindSchema,
});

/** Ajuste pedido, gravado no item como foi vendido (RN02). */
export const orderItemAdjustmentSchema = z.object({
  ingredientId: z.uuid(),
  name: z.string(),
  kind: adjustmentKindSchema,
});
export type OrderItemAdjustment = z.infer<typeof orderItemAdjustmentSchema>;
