import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Setor que recebe o item para preparo: cozinha, bar, pizzaria... */
export const productionSectors = pgTable(
  'production_sectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('production_sectors_name_uq').on(t.name)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('categories_name_uq').on(t.name)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    sectorId: uuid('sector_id').references(() => productionSectors.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    /** RN01: dinheiro sempre em centavos inteiros. */
    priceCents: integer('price_cents').notNull(),
    available: boolean('available').notNull().default(true),
    allowFractional: boolean('allow_fractional').notNull().default(false),
    /** Concorrência otimista: incrementa a cada alteração. */
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    check('products_price_nonnegative', sql`${t.priceCents} >= 0`),
    uniqueIndex('products_category_name_uq').on(t.categoryId, t.name),
  ],
);

/** Mesa é o local físico; comanda (próxima etapa) é a conta de consumo. */
export const diningTables = pgTable(
  'dining_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull(),
    label: text('label'),
    seats: integer('seats'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('dining_tables_number_uq').on(t.number),
    check('dining_tables_number_positive', sql`${t.number} > 0`),
  ],
);
