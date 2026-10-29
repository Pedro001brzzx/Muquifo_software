import { z } from 'zod';
import { cashSessionSchema, methodTotalsSchema } from './cash.js';
import { centsSchema } from './money.js';

/** Painel do dono: números do dia e pontos de atenção (possíveis desvios). */

export const dashboardQuerySchema = z.object({
  /** Dia no formato AAAA-MM-DD (fuso do servidor). Padrão: hoje. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.')
    .optional(),
});

const at = z.iso.datetime({ offset: true });

export const dashboardSchema = z.object({
  date: z.string(),
  /** Itens ativos de pedidos enviados no dia. */
  salesCents: centsSchema,
  orderCount: z.number().int(),
  /** Comandas com venda no dia. */
  tabCount: z.number().int(),
  averageTicketCents: centsSchema,
  /** Mesmo dia da semana anterior, para comparar. */
  lastWeekSalesCents: centsSchema,
  /** Pagamentos ativos lançados no dia. */
  received: methodTotalsSchema,
  /** 24 posições: vendas por hora. */
  byHour: z.array(centsSchema).length(24),
  topProducts: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      totalCents: centsSchema,
    }),
  ),
  openTabs: z.object({ count: z.number().int(), totalCents: centsSchema }),
  cash: cashSessionSchema.nullable(),
  attention: z.object({
    /** Itens cancelados depois de enviados à produção. */
    canceledItems: z.object({
      count: z.number().int(),
      totalCents: centsSchema,
      recent: z.array(
        z.object({
          productName: z.string(),
          totalCents: centsSchema,
          reason: z.string().nullable(),
          at,
          tabCode: z.number().int(),
        }),
      ),
    }),
    refunds: z.object({
      count: z.number().int(),
      totalCents: centsSchema,
      recent: z.array(
        z.object({
          method: z.string(),
          amountCents: centsSchema,
          reason: z.string().nullable(),
          at,
          tabCode: z.number().int(),
        }),
      ),
    }),
    releasedTabs: z.object({
      count: z.number().int(),
      recent: z.array(
        z.object({ tabCode: z.number().int(), reason: z.string(), at }),
      ),
    }),
    /** Caixas fechados no dia com diferença. */
    cashDifferences: z.array(
      z.object({
        number: z.number().int(),
        closedBy: z.string(),
        closedAt: at,
        differenceCents: z.number().int(),
      }),
    ),
  }),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
