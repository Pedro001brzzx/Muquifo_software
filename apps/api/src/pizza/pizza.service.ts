import {
  type createPizzaFlavorSchema,
  type createPizzaTierSchema,
  errorCodes,
  type listPizzaFlavorsQuerySchema,
  type listPizzaTiersQuerySchema,
  type PizzaFlavor,
  type PizzaTier,
  type PizzaTierPrice,
  type updatePizzaFlavorSchema,
  type updatePizzaTierSchema,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Executor, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import {
  pizzaFlavors,
  pizzaTierPrices,
  pizzaTiers,
  products,
} from '../db/schema.js';

type Status = 'active' | 'archived' | 'all';

const tierColumns = {
  id: pizzaTiers.id,
  name: pizzaTiers.name,
  sortOrder: pizzaTiers.sortOrder,
  active: pizzaTiers.active,
  // Nomes explícitos: em select de uma tabela só o Drizzle omite o nome da tabela.
  flavorCount: sql<number>`(select count(*) from pizza_flavors f where f.tier_id = pizza_tiers.id and f.active)::int`,
};

const flavorColumns = {
  id: pizzaFlavors.id,
  tierId: pizzaFlavors.tierId,
  name: pizzaFlavors.name,
  description: pizzaFlavors.description,
  available: pizzaFlavors.available,
  active: pizzaFlavors.active,
  sortOrder: pizzaFlavors.sortOrder,
};

const statusFilter = (
  column: typeof pizzaTiers.active | typeof pizzaFlavors.active,
  status: Status,
) => (status === 'all' ? undefined : eq(column, status === 'active'));

/** Troca a tabela de preços da faixa; só tamanhos de pizza entram. */
async function replacePrices(
  tx: Transaction,
  tierId: string,
  prices: PizzaTierPrice[],
) {
  if (prices.length) {
    const notPizza = await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(
        and(
          inArray(
            products.id,
            prices.map((p) => p.productId),
          ),
          isNull(products.maxFlavors),
        ),
      );
    if (notPizza.length) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        `${notPizza.map((p) => p.name).join(', ')} não é tamanho de pizza.`,
        { productIds: notPizza.map((p) => p.id) },
      );
    }
  }
  await tx.delete(pizzaTierPrices).where(eq(pizzaTierPrices.tierId, tierId));
  if (prices.length) {
    await tx
      .insert(pizzaTierPrices)
      .values(prices.map((p) => ({ tierId, ...p })));
  }
}

@Injectable()
export class PizzaService {
  constructor(@Inject(DB) private readonly db: Database) {}

  listTiers(
    query: z.output<typeof listPizzaTiersQuerySchema>,
  ): Promise<PizzaTier[]> {
    return this.loadTiers(
      this.db,
      statusFilter(pizzaTiers.active, query.status),
    );
  }

  createTier({
    prices,
    ...input
  }: z.output<typeof createPizzaTierSchema>): Promise<PizzaTier> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pizzaTiers)
        .values(input)
        .returning({ id: pizzaTiers.id });
      await replacePrices(tx, row.id, prices);
      return this.getTier(tx, row.id);
    });
  }

  /** Arquivar exige faixa sem sabores ativos, para nenhum sabor sumir sem querer. */
  updateTier(
    id: string,
    { prices, ...input }: z.output<typeof updatePizzaTierSchema>,
  ): Promise<PizzaTier> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ name: pizzaTiers.name, active: pizzaTiers.active })
        .from(pizzaTiers)
        .where(eq(pizzaTiers.id, id))
        .for('update');
      if (!current) throw AppException.notFound('Faixa', id);
      if (input.active === false && current.active) {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(pizzaFlavors)
          .where(
            and(eq(pizzaFlavors.tierId, id), eq(pizzaFlavors.active, true)),
          );
        if (n > 0) {
          throw new AppException(
            HttpStatus.CONFLICT,
            errorCodes.pizzaTierInUse,
            `A faixa ${current.name} tem ${n} ${n === 1 ? 'sabor ativo' : 'sabores ativos'}. Arquive ou mova os sabores antes.`,
            { activeFlavors: n },
          );
        }
      }
      if (Object.keys(input).length) {
        await tx.update(pizzaTiers).set(input).where(eq(pizzaTiers.id, id));
      }
      if (prices) await replacePrices(tx, id, prices);
      return this.getTier(tx, id);
    });
  }

  listFlavors(
    query: z.output<typeof listPizzaFlavorsQuerySchema>,
  ): Promise<PizzaFlavor[]> {
    return this.db
      .select(flavorColumns)
      .from(pizzaFlavors)
      .innerJoin(pizzaTiers, eq(pizzaTiers.id, pizzaFlavors.tierId))
      .where(statusFilter(pizzaFlavors.active, query.status))
      .orderBy(
        asc(pizzaTiers.sortOrder),
        asc(pizzaTiers.name),
        asc(pizzaFlavors.sortOrder),
        asc(sql`lower(${pizzaFlavors.name})`),
      );
  }

  async createFlavor(
    input: z.output<typeof createPizzaFlavorSchema>,
  ): Promise<PizzaFlavor> {
    const [row] = await this.db
      .insert(pizzaFlavors)
      .values(input)
      .returning(flavorColumns);
    return row;
  }

  /** Arquivado sai do cardápio; pedidos antigos continuam com o nome gravado. */
  async updateFlavor(
    id: string,
    input: z.output<typeof updatePizzaFlavorSchema>,
  ): Promise<PizzaFlavor> {
    const [row] = await this.db
      .update(pizzaFlavors)
      .set(input)
      .where(eq(pizzaFlavors.id, id))
      .returning(flavorColumns);
    if (!row) throw AppException.notFound('Sabor', id);
    return row;
  }

  private async getTier(db: Executor, id: string): Promise<PizzaTier> {
    const [tier] = await this.loadTiers(db, eq(pizzaTiers.id, id));
    return tier;
  }

  private async loadTiers(
    db: Executor,
    where: SQL | undefined,
  ): Promise<PizzaTier[]> {
    const rows = await db
      .select(tierColumns)
      .from(pizzaTiers)
      .where(where)
      .orderBy(asc(pizzaTiers.sortOrder), asc(pizzaTiers.name));
    const prices = rows.length
      ? await db
          .select()
          .from(pizzaTierPrices)
          .where(
            inArray(
              pizzaTierPrices.tierId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r,
      prices: prices
        .filter((p) => p.tierId === r.id)
        .map((p) => ({ productId: p.productId, priceCents: p.priceCents })),
    }));
  }
}
