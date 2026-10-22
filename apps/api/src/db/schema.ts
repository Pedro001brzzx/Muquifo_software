import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
    /** Código curto opcional para busca rápida no caixa. */
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'),
    /** RN01: dinheiro sempre em centavos inteiros. */
    priceCents: integer('price_cents').notNull(),
    /** Esgotado no momento. */
    available: boolean('available').notNull().default(true),
    allowFractional: boolean('allow_fractional').notNull().default(false),
    /** Arquivado sai do cardápio mas segue referenciado nos pedidos antigos. */
    active: boolean('active').notNull().default(true),
    /** Figura do cardápio (emoji). Nula = escolhida pelo nome na tela. */
    icon: text('icon'),
    /** Tamanho de pizza: aceita de 1 a N sabores. Nulo = não é pizza. */
    maxFlavors: integer('max_flavors'),
    /** Concorrência otimista: incrementa a cada alteração. */
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    check('products_price_nonnegative', sql`${t.priceCents} >= 0`),
    check(
      'products_max_flavors_range',
      sql`${t.maxFlavors} is null or ${t.maxFlavors} between 1 and 4`,
    ),
    uniqueIndex('products_category_name_uq').on(t.categoryId, t.name),
    uniqueIndex('products_code_uq').on(t.code),
  ],
);

// ---------- Complementos ----------

/** Grupo de complementos reutilizável: "Ponto da carne", "Adicionais", "Borda". */
export const optionGroups = pgTable(
  'option_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** 0 = opcional; >= 1 = obrigatório. */
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(1),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('option_groups_name_uq').on(t.name),
    check('option_groups_min_nonnegative', sql`${t.minSelect} >= 0`),
    check(
      'option_groups_max_gte_min',
      sql`${t.maxSelect} >= greatest(${t.minSelect}, 1)`,
    ),
  ],
);

/** Opção de um grupo. Removida da lista = arquivada (segue nos pedidos antigos). */
export const options = pgTable(
  'options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull().default(0),
    available: boolean('available').notNull().default(true),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Grupo que passa a valer quando esta opção é escolhida (Combo → Bebida do combo). */
    childGroupId: uuid('child_group_id').references(
      (): AnyPgColumn => optionGroups.id,
      { onDelete: 'restrict' },
    ),
    ...timestamps,
  },
  (t) => [
    index('options_group_idx').on(t.groupId),
    check(
      'options_child_not_own_group',
      sql`${t.childGroupId} is null or ${t.childGroupId} <> ${t.groupId}`,
    ),
    check('options_price_nonnegative', sql`${t.priceCents} >= 0`),
  ],
);

/** Grupos de um produto específico, além dos herdados da categoria. */
export const productOptionGroups = pgTable(
  'product_option_groups',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

/** Grupos da categoria desligados só neste produto. */
export const productExcludedOptionGroups = pgTable(
  'product_excluded_option_groups',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

// ---------- Ingredientes ----------

/** Biblioteca de ingredientes, reaproveitada na montagem dos lanches. */
export const ingredients = pgTable(
  'ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('ingredients_name_uq').on(sql`lower(${t.name})`)],
);

/** Receita do produto; ajustável aceita Sem/Pouco/Extra. */
export const productIngredients = pgTable(
  'product_ingredients',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    adjustable: boolean('adjustable').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.ingredientId] })],
);

export const adjustmentKind = pgEnum('adjustment_kind', [
  'remove',
  'less',
  'extra',
]);

/** Grupos que valem para todos os produtos da categoria. */
export const categoryOptionGroups = pgTable(
  'category_option_groups',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.groupId] })],
);

// ---------- Pizzaria ----------

/** Faixa de preço de sabores: "Tradicional", "Especial", "Doce". */
export const pizzaTiers = pgTable(
  'pizza_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('pizza_tiers_name_uq').on(sql`lower(${t.name})`)],
);

/** Preço da faixa em cada tamanho (produto com max_flavors). */
export const pizzaTierPrices = pgTable(
  'pizza_tier_prices',
  {
    tierId: uuid('tier_id')
      .notNull()
      .references(() => pizzaTiers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tierId, t.productId] }),
    check('pizza_tier_prices_nonnegative', sql`${t.priceCents} >= 0`),
  ],
);

export const pizzaFlavors = pgTable(
  'pizza_flavors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => pizzaTiers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    available: boolean('available').notNull().default(true),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pizza_flavors_name_uq').on(sql`lower(${t.name})`),
    index('pizza_flavors_tier_idx').on(t.tierId),
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
    /** Comanda cancelada (mesa liberada sem consumo) guarda motivo e horário (RN05). */
    cancelReason: text('cancel_reason'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tabs_code_uq').on(t.code),
    index('tabs_status_idx').on(t.status),
    index('tabs_table_idx').on(t.tableId),
    check(
      'tabs_cancel_reason',
      sql`${t.status} <> 'canceled' or ${t.cancelReason} is not null`,
    ),
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

/** Complemento vendido: nome e preço copiados no momento da venda (RN02). */
export const orderItemOptions = pgTable(
  'order_item_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => options.id, { onDelete: 'restrict' }),
    groupName: text('group_name').notNull(),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('order_item_options_item_idx').on(t.orderItemId)],
);

/** Ajuste de ingrediente vendido (Sem/Pouco/Extra), com o nome do momento (RN02). */
export const orderItemAdjustments = pgTable(
  'order_item_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    ingredientName: text('ingredient_name').notNull(),
    kind: adjustmentKind('kind').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('order_item_adjustments_item_idx').on(t.orderItemId)],
);

/** Sabor de pizza vendido, com nome, faixa e preço do momento (RN02). */
export const orderItemFlavors = pgTable(
  'order_item_flavors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    flavorId: uuid('flavor_id')
      .notNull()
      .references(() => pizzaFlavors.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    tierName: text('tier_name').notNull(),
    priceCents: integer('price_cents').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('order_item_flavors_item_idx').on(t.orderItemId)],
);

export const paymentMethod = pgEnum('payment_method', [
  'cash',
  'credit',
  'debit',
  'pix',
]);
export const paymentStatus = pgEnum('payment_status', ['active', 'canceled']);

/**
 * Pagamento manual registrado no caixa (RF07). `amountCents` é o que abate da conta;
 * em dinheiro, `receivedCents` é o valor entregue e `changeCents` o troco.
 * Estorno marca como cancelado com motivo; nunca apaga (RN05).
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: integer('seq').notNull().generatedAlwaysAsIdentity(),
    tabId: uuid('tab_id')
      .notNull()
      .references(() => tabs.id, { onDelete: 'restrict' }),
    method: paymentMethod('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    receivedCents: integer('received_cents'),
    changeCents: integer('change_cents').notNull().default(0),
    status: paymentStatus('status').notNull().default('active'),
    cancelReason: text('cancel_reason'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('payments_tab_idx').on(t.tabId),
    check('payments_amount_positive', sql`${t.amountCents} > 0`),
    check('payments_change_nonnegative', sql`${t.changeCents} >= 0`),
    check(
      'payments_cancel_reason',
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
