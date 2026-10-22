import { z } from 'zod';
import {
  productIngredientSchema,
  productIngredientsInputSchema,
} from './ingredients.js';
import { centsSchema } from './money.js';
import { optionGroupIdsSchema } from './options.js';
import { MAX_PIZZA_FLAVORS } from './pizza.js';

/** Figura do cardápio: um emoji (ex.: "🍔"). */
const iconSchema = z.string().trim().min(1).max(16);

/** Preenchido = o produto é um tamanho de pizza e aceita até N sabores. */
const maxFlavorsSchema = z.number().int().min(1).max(MAX_PIZZA_FLAVORS);

const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(500);

/** Código curto opcional para o caixa achar o produto rápido ("X01", "PIZ-G"). */
export const productCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(20)
  .regex(/^[A-Z0-9-]+$/, 'Use só letras, números e hífen.');

export const productionSectorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});
export type ProductionSector = z.infer<typeof productionSectorSchema>;

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** Complementos que valem para todos os produtos da categoria. */
  optionGroupIds: z.array(z.uuid()),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategorySchema = z.object({
  name: nameSchema,
  sortOrder: z.number().int().min(0).default(0),
  optionGroupIds: optionGroupIdsSchema.default([]),
});
export type CreateCategoryInput = z.input<typeof createCategorySchema>;

/** Arquivar categoria só é permitido sem produtos ativos nela. */
export const updateCategorySchema = z
  .object({
    name: nameSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    optionGroupIds: optionGroupIdsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo.',
  });
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

export const productSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  sectorId: z.uuid().nullable(),
  code: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: centsSchema,
  /** Esgotado no momento (volta a vender sem editar o cadastro). */
  available: z.boolean(),
  allowFractional: z.boolean(),
  /** Arquivado = fora do cardápio; continua nos pedidos antigos (RN02). */
  active: z.boolean(),
  /** Complementos só deste produto (os da categoria valem também). */
  optionGroupIds: z.array(z.uuid()),
  /** Grupos da categoria desligados só neste produto. */
  excludedOptionGroupIds: z.array(z.uuid()),
  /** Receita, na ordem; ajustáveis aceitam Sem/Pouco/Extra. */
  ingredients: z.array(productIngredientSchema),
  /** Tamanho de pizza: quantos sabores aceita (P=1, M=2, G=3). Nulo = não é pizza. */
  maxFlavors: z.number().int().nullable(),
  /** Figura escolhida; nula = a tela deduz pelo nome. */
  icon: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Product = z.infer<typeof productSchema>;

export const createProductSchema = z.object({
  categoryId: z.uuid(),
  sectorId: z.uuid().nullable().default(null),
  code: productCodeSchema.nullable().default(null),
  name: nameSchema,
  description: descriptionSchema.nullable().default(null),
  priceCents: centsSchema,
  allowFractional: z.boolean().default(false),
  available: z.boolean().default(true),
  optionGroupIds: optionGroupIdsSchema.default([]),
  excludedOptionGroupIds: optionGroupIdsSchema.default([]),
  ingredients: productIngredientsInputSchema.default([]),
  maxFlavors: maxFlavorsSchema.nullable().default(null),
  icon: iconSchema.nullable().default(null),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

/**
 * Edição parcial com `version` (concorrência otimista: 409 se o produto mudou).
 * Mudar o preço não afeta itens já lançados (RN02).
 */
export const updateProductSchema = z
  .object({
    version: z.number().int().positive(),
    categoryId: z.uuid().optional(),
    sectorId: z.uuid().nullable().optional(),
    code: productCodeSchema.nullable().optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    priceCents: centsSchema.optional(),
    allowFractional: z.boolean().optional(),
    available: z.boolean().optional(),
    active: z.boolean().optional(),
    optionGroupIds: optionGroupIdsSchema.optional(),
    excludedOptionGroupIds: optionGroupIdsSchema.optional(),
    ingredients: productIngredientsInputSchema.optional(),
    maxFlavors: maxFlavorsSchema.nullable().optional(),
    icon: iconSchema.nullable().optional(),
  })
  .refine(
    ({ version: _, ...fields }) =>
      Object.values(fields).some((x) => x !== undefined),
    { message: 'Informe ao menos um campo para alterar.' },
  );
export type UpdateProductInput = z.input<typeof updateProductSchema>;

/** `version` implementa concorrência otimista: a alteração falha com 409 se o produto mudou. */
export const updateProductAvailabilitySchema = z.object({
  available: z.boolean(),
  version: z.number().int().positive(),
});
export type UpdateProductAvailabilityInput = z.input<
  typeof updateProductAvailabilitySchema
>;

export const productStatusFilterSchema = z.enum(['active', 'archived', 'all']);
export type ProductStatusFilter = z.infer<typeof productStatusFilterSchema>;

export const listProductsQuerySchema = z.object({
  categoryId: z.uuid().optional(),
  available: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Padrão `active`: arquivados só aparecem quando pedidos. */
  status: productStatusFilterSchema.default('active'),
});
