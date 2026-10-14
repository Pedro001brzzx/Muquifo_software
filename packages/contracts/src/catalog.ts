import { z } from 'zod';
import { centsSchema } from './money.js';

const nameSchema = z.string().trim().min(1).max(120);

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
});
export type Category = z.infer<typeof categorySchema>;

export const createCategorySchema = z.object({
  name: nameSchema,
  sortOrder: z.number().int().min(0).default(0),
});
export type CreateCategoryInput = z.input<typeof createCategorySchema>;

export const productSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  sectorId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: centsSchema,
  available: z.boolean(),
  allowFractional: z.boolean(),
  version: z.number().int(),
});
export type Product = z.infer<typeof productSchema>;

export const createProductSchema = z.object({
  categoryId: z.uuid(),
  sectorId: z.uuid().nullable().default(null),
  name: nameSchema,
  description: z.string().trim().max(500).nullable().default(null),
  priceCents: centsSchema,
  allowFractional: z.boolean().default(false),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

/** `version` implementa concorrência otimista: a alteração falha com 409 se o produto mudou. */
export const updateProductAvailabilitySchema = z.object({
  available: z.boolean(),
  version: z.number().int().positive(),
});
export type UpdateProductAvailabilityInput = z.input<
  typeof updateProductAvailabilitySchema
>;

export const listProductsQuerySchema = z.object({
  categoryId: z.uuid().optional(),
  available: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
