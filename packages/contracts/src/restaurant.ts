import { z } from 'zod';

/**
 * Identidade do restaurante (registro único): aparece no topo do cardápio do
 * cliente. Vazio até o dono preencher; o cardápio cai em "Cardápio".
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const restaurantSchema = z.object({
  name: z.string(),
  /** Frase curta abaixo do nome (ex.: "Lanches e pizzas desde 1998"). */
  tagline: z.string().nullable(),
  /** Aviso em destaque no cardápio (ex.: "Cozinha fecha às 23h"). */
  notice: z.string().nullable(),
  version: z.number().int(),
});
export type Restaurant = z.infer<typeof restaurantSchema>;

export const updateRestaurantSchema = z.object({
  version: z.number().int().nonnegative(),
  name: z.string().trim().max(60),
  tagline: optionalText(80),
  notice: optionalText(200),
});
export type UpdateRestaurantInput = z.input<typeof updateRestaurantSchema>;
