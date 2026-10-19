import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
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

// ---------- Comandas e pedidos ----------

export const tabStatus = pgEnum('tab_status', [
  'open',
  'closing',
  'closed',
  'canceled',
]);
export const orderStatus = pgEnum('order_status', [
  'draft',
  'submitted',
  'canceled',
]);
export const orderChannel = pgEnum('order_channel', [
  'table',
  'counter',
  'pickup',
  'delivery',
]);
export const orderItemStatus = pgEnum('order_item_status', [
  'active',
  'canceled',
]);

/** Comanda: a conta de consumo. Pode estar ligada a uma mesa ou não (balcão, retirada). */
export const tabs = pgTable(
  'tabs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Número curto exibido ao atendente ("Comanda 1042"). */
    code: integer('code')
      .notNull()
      .generatedAlwaysAsIdentity({ startWith: 1000 }),
    tableId: uuid('table_id').references(() => diningTables.id, {
      onDelete: 'restrict',
    }),
    customerName: text('customer_name'),
    status: tabStatus('status').notNull().default('open'),
    version: integer('version').notNull().default(1),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tabs_code_uq').on(t.code),
    index('tabs_status_idx').on(t.status),
    index('tabs_table_idx').on(t.tableId),
  ],
);

/** Pedido: uma rodada de solicitação dentro da comanda. */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    tabId: uuid('tab_id')
      .notNull()
      .references(() => tabs.id, { onDelete: 'restrict' }),
    channel: orderChannel('channel').notNull(),
    status: orderStatus('status').notNull().default('draft'),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_number_uq').on(t.number),
    index('orders_tab_idx').on(t.tabId),
  ],
);

/** Item vendido. Nome, preço e setor são copiados do cardápio no momento da venda (RN02). */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Ordem de inserção estável (created_at é igual dentro da mesma transação). */
    seq: integer('seq').notNull().generatedAlwaysAsIdentity(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    productName: text('product_name').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: numeric('quantity', {
      precision: 10,
      scale: 3,
      mode: 'number',
    }).notNull(),
    totalCents: integer('total_cents').notNull(),
    sectorId: uuid('sector_id').references(() => productionSectors.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    status: orderItemStatus('status').notNull().default('active'),
    cancelReason: text('cancel_reason'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check('order_items_unit_price_nonnegative', sql`${t.unitPriceCents} >= 0`),
    check('order_items_total_nonnegative', sql`${t.totalCents} >= 0`),
    check(
      'order_items_cancel_reason',
      sql`${t.status} <> 'canceled' or ${t.cancelReason} is not null`,
    ),
  ],
);

/**
 * Operações idempotentes: a chave enviada pelo cliente e o resultado são gravados
 * na mesma transação do efeito, então um reenvio devolve o resultado original.
 */
export const operations = pgTable('operations', {
  id: uuid('id').primaryKey(),
  scope: text('scope').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code'),
  response: jsonb('response'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
