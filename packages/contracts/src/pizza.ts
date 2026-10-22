import { z } from 'zod';
import { centsSchema } from './money.js';

/**
 * Pizzaria. Cada tamanho é um produto com `maxFlavors` (P=1, M=2, G=3).
 * Sabores ficam em faixas de preço (Tradicional, Especial...) e cada faixa
 * tem um preço por tamanho. Pizza com vários sabores cobra o da faixa mais cara.
 */

export const MAX_PIZZA_FLAVORS = 4;

const nameSchema = z.string().trim().min(1).max(60);
const statusQuerySchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

/** Preço da faixa num tamanho (produto pizza). */
export const pizzaTierPriceSchema = z.object({
  productId: z.uuid(),
  priceCents: centsSchema,
});
export type PizzaTierPrice = z.infer<typeof pizzaTierPriceSchema>;

const pricesInputSchema = z
  .array(pizzaTierPriceSchema)
  .max(20)
  .refine(
    (list) => new Set(list.map((p) => p.productId)).size === list.length,
    'Tamanho repetido.',
  );

export const pizzaTierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** Tamanho sem preço = os sabores desta faixa não saem nele. */
  prices: z.array(pizzaTierPriceSchema),
  /** Sabores ativos na faixa. */
  flavorCount: z.number().int(),
});
export type PizzaTier = z.infer<typeof pizzaTierSchema>;

export const createPizzaTierSchema = z.object({
  name: nameSchema,
  sortOrder: z.number().int().min(0).default(0),
  prices: pricesInputSchema.default([]),
});
export type CreatePizzaTierInput = z.input<typeof createPizzaTierSchema>;

/** `prices`, se enviado, é a tabela completa da faixa. Arquivar exige faixa sem sabores ativos. */
export const updatePizzaTierSchema = z
  .object({
    name: nameSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    prices: pricesInputSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo.',
  });
export type UpdatePizzaTierInput = z.input<typeof updatePizzaTierSchema>;

export const listPizzaTiersQuerySchema = statusQuerySchema;

export const pizzaFlavorSchema = z.object({
  id: z.uuid(),
  tierId: z.uuid(),
  name: z.string(),
  /** Ingredientes do sabor, mostrados ao garçom ("molho, mussarela, calabresa"). */
  description: z.string().nullable(),
  /** Em falta no momento. */
  available: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type PizzaFlavor = z.infer<typeof pizzaFlavorSchema>;

const descriptionSchema = z.string().trim().max(300);

export const createPizzaFlavorSchema = z.object({
  tierId: z.uuid(),
  name: nameSchema,
  description: descriptionSchema.nullable().default(null),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});
export type CreatePizzaFlavorInput = z.input<typeof createPizzaFlavorSchema>;

export const updatePizzaFlavorSchema = z
  .object({
    tierId: z.uuid().optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    available: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo.',
  });
export type UpdatePizzaFlavorInput = z.input<typeof updatePizzaFlavorSchema>;

export const listPizzaFlavorsQuerySchema = statusQuerySchema;

/** Sabor vendido, com nome, faixa e preço do momento (RN02). */
export const orderItemFlavorSchema = z.object({
  flavorId: z.uuid(),
  name: z.string(),
  tierName: z.string(),
  /** Preço da faixa no tamanho; o item cobra o maior. */
  priceCents: centsSchema,
});
export type OrderItemFlavor = z.infer<typeof orderItemFlavorSchema>;

/** "1/2 Calabresa · 1/2 Portuguesa"; um sabor só sai sem fração. */
export const flavorsText = (flavors: { name: string }[]) =>
  flavors
    .map((f) => (flavors.length > 1 ? `1/${flavors.length} ${f.name}` : f.name))
    .join(' · ');
