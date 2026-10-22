import type {
  createIngredientSchema,
  Ingredient,
  listIngredientsQuerySchema,
  updateIngredientSchema,
} from '@muquifo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { ingredients } from '../db/schema.js';

const columns = {
  id: ingredients.id,
  name: ingredients.name,
  active: ingredients.active,
  // Nomes explícitos: em select de uma tabela só o Drizzle omite o nome da tabela
  // nas colunas, e "id" seria resolvido dentro da subconsulta (products.id).
  productCount: sql<number>`(select count(*) from product_ingredients pi join products p on p.id = pi.product_id where pi.ingredient_id = ingredients.id and p.active)::int`,
};

@Injectable()
export class IngredientsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(
    query: z.output<typeof listIngredientsQuerySchema>,
  ): Promise<Ingredient[]> {
    const where: SQL | undefined =
      query.status === 'all'
        ? undefined
        : eq(ingredients.active, query.status === 'active');
    return this.db
      .select(columns)
      .from(ingredients)
      .where(where)
      .orderBy(asc(sql`lower(${ingredients.name})`));
  }

  async create(
    input: z.output<typeof createIngredientSchema>,
  ): Promise<Ingredient> {
    const [row] = await this.db
      .insert(ingredients)
      .values(input)
      .returning({ id: ingredients.id });
    return this.get(row.id);
  }

  /** Arquivar tira da biblioteca; os produtos que já usam continuam com ele. */
  async update(
    id: string,
    input: z.output<typeof updateIngredientSchema>,
  ): Promise<Ingredient> {
    const rows = await this.db
      .update(ingredients)
      .set(input)
      .where(eq(ingredients.id, id))
      .returning({ id: ingredients.id });
    if (rows.length === 0) throw AppException.notFound('Ingrediente', id);
    return this.get(id);
  }

  private async get(id: string): Promise<Ingredient> {
    const [row] = await this.db
      .select(columns)
      .from(ingredients)
      .where(eq(ingredients.id, id));
    return row;
  }
}
