import type {
  Order,
  OrderItem,
  OrderItemAdjustment,
  OrderItemFlavor,
  OrderItemOption,
  Payment,
  TabDetail,
  TabStatus,
  TabSummary,
} from '@muquifo/contracts';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AppException } from '../common/app-exception.js';
import type { Executor, Transaction } from '../db/client.js';
import {
  diningTables,
  orderItemAdjustments,
  orderItemFlavors,
  orderItemOptions,
  orderItems,
  orders,
  payments,
  tabs,
} from '../db/schema.js';

type TabRow = typeof tabs.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toItem(
  row: OrderItemRow,
  options: OrderItemOption[],
  adjustments: OrderItemAdjustment[],
  flavors: OrderItemFlavor[],
): OrderItem {
  return {
    options,
    adjustments,
    flavors,
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    productName: row.productName,
    unitPriceCents: row.unitPriceCents,
    quantity: row.quantity,
    totalCents: row.totalCents,
    sectorId: row.sectorId,
    notes: row.notes,
    status: row.status,
    cancelReason: row.cancelReason,
    canceledAt: iso(row.canceledAt),
    createdAt: row.createdAt.toISOString(),
  };
}

const activeTotal = (items: OrderItem[]) =>
  items
    .filter((i) => i.status === 'active')
    .reduce((sum, i) => sum + i.totalCents, 0);

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    number: row.number,
    tabId: row.tabId,
    channel: row.channel,
    status: row.status,
    notes: row.notes,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    canceledAt: iso(row.canceledAt),
    cancelReason: row.cancelReason,
    totalCents: activeTotal(items),
    items,
  };
}

async function loadOrders(db: Executor, where: SQL): Promise<Order[]> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(asc(orders.number));
  if (orderRows.length === 0) return [];
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        orderRows.map((o) => o.id),
      ),
    )
    .orderBy(asc(orderItems.seq));
  const itemIds = itemRows.map((i) => i.id);
  const [optionRows, adjustmentRows, flavorRows] = itemIds.length
    ? await Promise.all([
        db
          .select()
          .from(orderItemOptions)
          .where(inArray(orderItemOptions.orderItemId, itemIds))
          .orderBy(asc(orderItemOptions.sortOrder)),
        db
          .select()
          .from(orderItemAdjustments)
          .where(inArray(orderItemAdjustments.orderItemId, itemIds))
          .orderBy(asc(orderItemAdjustments.sortOrder)),
        db
          .select()
          .from(orderItemFlavors)
          .where(inArray(orderItemFlavors.orderItemId, itemIds))
          .orderBy(asc(orderItemFlavors.sortOrder)),
      ])
    : [[], [], []];
  const flavorsOf = (itemId: string): OrderItemFlavor[] =>
    flavorRows
      .filter((f) => f.orderItemId === itemId)
      .map((f) => ({
        flavorId: f.flavorId,
        name: f.name,
        tierName: f.tierName,
        priceCents: f.priceCents,
      }));
  const adjustmentsOf = (itemId: string): OrderItemAdjustment[] =>
    adjustmentRows
      .filter((a) => a.orderItemId === itemId)
      .map((a) => ({
        ingredientId: a.ingredientId,
        name: a.ingredientName,
        kind: a.kind,
      }));
  const optionsOf = (itemId: string): OrderItemOption[] =>
    optionRows
      .filter((o) => o.orderItemId === itemId)
      .map((o) => ({
        optionId: o.optionId,
        groupName: o.groupName,
        name: o.name,
        priceCents: o.priceCents,
      }));
  return orderRows.map((o) =>
    toOrder(
      o,
      itemRows
        .filter((i) => i.orderId === o.id)
        .map((i) =>
          toItem(i, optionsOf(i.id), adjustmentsOf(i.id), flavorsOf(i.id)),
        ),
    ),
  );
}

export async function getOrder(db: Executor, id: string): Promise<Order> {
  const [order] = await loadOrders(db, eq(orders.id, id));
  if (!order) throw AppException.notFound('Pedido', id);
  return order;
}

/** Itens ativos de pedidos enviados somam na conta; canceladas e rascunhos não. */
const tabTotals = (db: Executor) =>
  db
    .select({
      tabId: orders.tabId,
      total: sql<number>`coalesce(sum(${orderItems.totalCents}), 0)::int`.as(
        'total',
      ),
      itemCount: sql<number>`count(${orderItems.id})::int`.as('item_count'),
    })
    .from(orders)
    .innerJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), eq(orderItems.status, 'active')),
    )
    .where(eq(orders.status, 'submitted'))
    .groupBy(orders.tabId)
    .as('tab_totals');

async function selectTabs(db: Executor, where?: SQL): Promise<TabSummary[]> {
  const totals = tabTotals(db);
  const rows = await db
    .select({
      tab: tabs,
      tableNumber: diningTables.number,
      totalCents: sql<number>`coalesce(${totals.total}, 0)`,
      itemCount: sql<number>`coalesce(${totals.itemCount}, 0)`,
    })
    .from(tabs)
    .leftJoin(diningTables, eq(diningTables.id, tabs.tableId))
    .leftJoin(totals, eq(totals.tabId, tabs.id))
    .where(where)
    .orderBy(desc(tabs.openedAt));
  return rows.map(({ tab, tableNumber, totalCents, itemCount }) => ({
    id: tab.id,
    code: tab.code,
    tableId: tab.tableId,
    tableNumber,
    customerName: tab.customerName,
    status: tab.status,
    version: tab.version,
    openedAt: tab.openedAt.toISOString(),
    closedAt: iso(tab.closedAt),
    totalCents: Number(totalCents),
    itemCount: Number(itemCount),
  }));
}

export function listTabs(
  db: Executor,
  query: { status?: TabStatus; tableId?: string },
): Promise<TabSummary[]> {
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(tabs.status, query.status));
  if (query.tableId) filters.push(eq(tabs.tableId, query.tableId));
  return selectTabs(db, and(...filters));
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    tabId: row.tabId,
    method: row.method,
    amountCents: row.amountCents,
    receivedCents: row.receivedCents,
    changeCents: row.changeCents,
    status: row.status,
    cancelReason: row.cancelReason,
    canceledAt: iso(row.canceledAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getTab(db: Executor, id: string): Promise<TabDetail> {
  const [summary] = await selectTabs(db, eq(tabs.id, id));
  if (!summary) throw AppException.notFound('Comanda', id);
  const [tabOrders, paymentRows, [cancel]] = await Promise.all([
    loadOrders(db, eq(orders.tabId, id)),
    db
      .select()
      .from(payments)
      .where(eq(payments.tabId, id))
      .orderBy(asc(payments.seq)),
    db
      .select({ reason: tabs.cancelReason, at: tabs.canceledAt })
      .from(tabs)
      .where(eq(tabs.id, id)),
  ]);
  const draftCents = tabOrders
    .filter((o) => o.status === 'draft')
    .reduce((sum, o) => sum + o.totalCents, 0);
  const tabPayments = paymentRows.map(toPayment);
  const paidCents = tabPayments
    .filter((p) => p.status === 'active')
    .reduce((sum, p) => sum + p.amountCents, 0);
  return {
    ...summary,
    draftCents,
    paidCents,
    balanceCents: summary.totalCents - paidCents,
    cancelReason: cancel.reason,
    canceledAt: iso(cancel.at),
    orders: tabOrders,
    payments: tabPayments,
  };
}

/**
 * Valores da conta calculados dentro da transação, com a comanda já travada:
 * total enviado, pago, itens ativos em rascunho e pedidos em rascunho.
 */
export async function tabBalance(tx: Transaction, tabId: string) {
  const [row] = await tx
    .execute<{
      total: number;
      paid: number;
      draft_items: number;
    }>(sql`
    select
      coalesce((select sum(i.total_cents) from ${orderItems} i join ${orders} o on o.id = i.order_id
        where o.tab_id = ${tabId} and o.status = 'submitted' and i.status = 'active'), 0)::int as total,
      coalesce((select sum(p.amount_cents) from ${payments} p
        where p.tab_id = ${tabId} and p.status = 'active'), 0)::int as paid,
      (select count(*) from ${orderItems} i join ${orders} o on o.id = i.order_id
        where o.tab_id = ${tabId} and o.status = 'draft' and i.status = 'active')::int as draft_items
  `)
    .then((r) => r.rows);
  return {
    totalCents: row.total,
    paidCents: row.paid,
    balanceCents: row.total - row.paid,
    draftItems: row.draft_items,
  };
}

// ---------- Travas de linha ----------
// Ordem fixa de travamento (comanda → pedido) para evitar deadlock entre operações.

export async function lockTab(tx: Transaction, id: string): Promise<TabRow> {
  const [row] = await tx
    .select()
    .from(tabs)
    .where(eq(tabs.id, id))
    .for('update');
  if (!row) throw AppException.notFound('Comanda', id);
  return row;
}

export async function lockOrderWithTab(
  tx: Transaction,
  orderId: string,
): Promise<{ order: OrderRow; tab: TabRow }> {
  const [ref] = await tx
    .select({ tabId: orders.tabId })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!ref) throw AppException.notFound('Pedido', orderId);
  const tab = await lockTab(tx, ref.tabId);
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .for('update');
  return { order, tab };
}

/** Toda alteração de conteúdo da comanda incrementa a versão dela. */
export async function touchTab(tx: Transaction, id: string): Promise<void> {
  await tx
    .update(tabs)
    .set({ version: sql`${tabs.version} + 1` })
    .where(eq(tabs.id, id));
}

export async function touchOrder(tx: Transaction, id: string): Promise<void> {
  await tx
    .update(orders)
    .set({ version: sql`${orders.version} + 1` })
    .where(eq(orders.id, id));
}
