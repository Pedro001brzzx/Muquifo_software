import type { Dashboard, MethodTotals } from '@muquifo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  type SQL,
  sql,
} from 'drizzle-orm';
import { CashService } from '../cash/cash.service.js';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import {
  cashSessions,
  orderItems,
  orders,
  payments,
  tabs,
} from '../db/schema.js';

const DAY = 24 * 60 * 60 * 1000;
const RECENT = 5;

/** Início do dia no fuso do servidor (o computador do restaurante). */
function dayStart(date?: string): Date {
  if (!date) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const between = (column: Parameters<typeof gte>[0], from: Date, to: Date) =>
  and(gte(column, from), lt(column, to)) as SQL;

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cash: CashService,
  ) {}

  async day(date?: string): Promise<Dashboard> {
    const from = dayStart(date);
    const to = new Date(from.getTime() + DAY);
    const db = this.db;

    /** Itens vendidos: ativos, de pedidos enviados na janela. */
    const sold = (a: Date, b: Date) =>
      db
        .select({
          name: orderItems.productName,
          quantity: orderItems.quantity,
          totalCents: orderItems.totalCents,
          orderId: orders.id,
          tabId: orders.tabId,
          submittedAt: orders.submittedAt,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orderItems.status, 'active'),
            between(orders.submittedAt, a, b),
          ),
        );

    const [
      items,
      lastWeek,
      paid,
      open,
      cash,
      canceled,
      refunds,
      released,
      closedCash,
    ] = await Promise.all([
      sold(from, to),
      sold(
        new Date(from.getTime() - 7 * DAY),
        new Date(to.getTime() - 7 * DAY),
      ),
      db
        .select({
          method: payments.method,
          total: sql<number>`sum(${payments.amountCents})::int`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'active'),
            between(payments.createdAt, from, to),
          ),
        )
        .groupBy(payments.method),
      db
        .select({
          count: sql<number>`count(distinct ${tabs.id})::int`,
          total: sql<number>`coalesce(sum(${orderItems.totalCents}) filter (where ${orderItems.status} = 'active' and ${orders.status} = 'submitted'), 0)::int`,
        })
        .from(tabs)
        .leftJoin(orders, eq(orders.tabId, tabs.id))
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(inArray(tabs.status, ['open', 'closing'])),
      this.cash.current(),
      // Cancelado depois de enviado à produção (rascunho cancelado não pesa).
      db
        .select({
          productName: orderItems.productName,
          totalCents: orderItems.totalCents,
          reason: orderItems.cancelReason,
          at: orderItems.canceledAt,
          tabCode: tabs.code,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(tabs, eq(tabs.id, orders.tabId))
        .where(
          and(
            eq(orderItems.status, 'canceled'),
            isNotNull(orders.submittedAt),
            between(orderItems.canceledAt, from, to),
          ),
        )
        .orderBy(desc(orderItems.canceledAt)),
      db
        .select({
          method: payments.method,
          amountCents: payments.amountCents,
          reason: payments.cancelReason,
          at: payments.canceledAt,
          tabCode: tabs.code,
        })
        .from(payments)
        .innerJoin(tabs, eq(tabs.id, payments.tabId))
        .where(
          and(
            eq(payments.status, 'canceled'),
            between(payments.canceledAt, from, to),
          ),
        )
        .orderBy(desc(payments.canceledAt)),
      db
        .select({
          tabCode: tabs.code,
          reason: tabs.cancelReason,
          at: tabs.canceledAt,
        })
        .from(tabs)
        .where(
          and(eq(tabs.status, 'canceled'), between(tabs.canceledAt, from, to)),
        )
        .orderBy(desc(tabs.canceledAt)),
      db
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.status, 'closed'),
            between(cashSessions.closedAt, from, to),
          ),
        )
        .orderBy(desc(cashSessions.closedAt)),
    ]);

    const salesCents = items.reduce((s, i) => s + i.totalCents, 0);
    const tabCount = new Set(items.map((i) => i.tabId)).size;
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const i of items) {
      if (i.submittedAt) byHour[i.submittedAt.getHours()] += i.totalCents;
    }
    const products = new Map<
      string,
      { quantity: number; totalCents: number }
    >();
    for (const i of items) {
      const p = products.get(i.name) ?? { quantity: 0, totalCents: 0 };
      p.quantity += i.quantity;
      p.totalCents += i.totalCents;
      products.set(i.name, p);
    }
    const received: MethodTotals = { cash: 0, credit: 0, debit: 0, pix: 0 };
    for (const p of paid) received[p.method] = p.total;

    const iso = (d: Date | null) => (d ?? from).toISOString();

    return {
      date: localDate(from),
      salesCents,
      orderCount: new Set(items.map((i) => i.orderId)).size,
      tabCount,
      averageTicketCents: tabCount ? Math.round(salesCents / tabCount) : 0,
      lastWeekSalesCents: lastWeek.reduce((s, i) => s + i.totalCents, 0),
      received,
      byHour,
      topProducts: [...products.entries()]
        .map(([name, p]) => ({
          name,
          quantity: Math.round(p.quantity * 1000) / 1000,
          totalCents: p.totalCents,
        }))
        .sort((a, b) => b.totalCents - a.totalCents)
        .slice(0, 8),
      openTabs: { count: open[0]?.count ?? 0, totalCents: open[0]?.total ?? 0 },
      cash,
      attention: {
        canceledItems: {
          count: canceled.length,
          totalCents: canceled.reduce((s, c) => s + c.totalCents, 0),
          recent: canceled
            .slice(0, RECENT)
            .map((c) => ({ ...c, at: iso(c.at) })),
        },
        refunds: {
          count: refunds.length,
          totalCents: refunds.reduce((s, r) => s + r.amountCents, 0),
          recent: refunds
            .slice(0, RECENT)
            .map((r) => ({ ...r, at: iso(r.at) })),
        },
        releasedTabs: {
          count: released.length,
          recent: released.slice(0, RECENT).map((r) => ({
            tabCode: r.tabCode,
            reason: r.reason ?? '',
            at: iso(r.at),
          })),
        },
        cashDifferences: closedCash
          .map((s) => ({
            number: s.number,
            closedBy: s.closedBy ?? '',
            closedAt: iso(s.closedAt),
            differenceCents:
              (s.countedCashCents ?? 0) +
              (s.countedCreditCents ?? 0) +
              (s.countedDebitCents ?? 0) +
              (s.countedPixCents ?? 0) -
              ((s.expectedCashCents ?? 0) +
                (s.expectedCreditCents ?? 0) +
                (s.expectedDebitCents ?? 0) +
                (s.expectedPixCents ?? 0)),
          }))
          .filter((s) => s.differenceCents !== 0),
      },
    };
  }
}
