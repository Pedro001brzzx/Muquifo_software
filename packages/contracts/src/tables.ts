import { z } from 'zod';

/** Estado derivado das comandas abertas; até o módulo de comandas existir, toda mesa ativa é "free". */
export const tableStatusSchema = z.enum(['free', 'occupied', 'closing']);
export type TableStatus = z.infer<typeof tableStatusSchema>;

export const diningTableSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  label: z.string().nullable(),
  seats: z.number().int().positive().nullable(),
  active: z.boolean(),
  status: tableStatusSchema,
});
export type DiningTable = z.infer<typeof diningTableSchema>;

export const createDiningTableSchema = z.object({
  number: z.number().int().positive().max(9999),
  label: z.string().trim().max(60).nullable().default(null),
  seats: z.number().int().positive().max(100).nullable().default(null),
});
export type CreateDiningTableInput = z.input<typeof createDiningTableSchema>;
