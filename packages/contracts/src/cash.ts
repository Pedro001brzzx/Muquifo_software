import { z } from 'zod';
import { centsSchema } from './money.js';

/**
 * Caixa: um aberto por vez. Abre com o fundo de troco contado, recebe os
 * pagamentos, registra sangrias e suprimentos e fecha "às cegas": o
 * operador informa o que contou sem ver o esperado; a diferença fica gravada.
 */

export const cashSessionStatusSchema = z.enum(['open', 'closed']);
export type CashSessionStatus = z.infer<typeof cashSessionStatusSchema>;

export const cashMovementKindSchema = z.enum(['withdrawal', 'reinforcement']);
export type CashMovementKind = z.infer<typeof cashMovementKindSchema>;

export const cashMovementKindLabel: Record<CashMovementKind, string> = {
  withdrawal: 'Sangria',
  reinforcement: 'Suprimento',
};

/** Valores por forma de pagamento. */
export const methodTotalsSchema = z.object({
  cash: z.number().int(),
  credit: z.number().int(),
  debit: z.number().int(),
  pix: z.number().int(),
});
export type MethodTotals = z.infer<typeof methodTotalsSchema>;

const operatorSchema = z.string().trim().min(1).max(60);

export const cashMovementSchema = z.object({
  id: z.uuid(),
  kind: cashMovementKindSchema,
  amountCents: centsSchema,
  reason: z.string(),
  operator: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type CashMovement = z.infer<typeof cashMovementSchema>;

export const cashSessionSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: cashSessionStatusSchema,
  openedBy: z.string(),
  openedAt: z.iso.datetime({ offset: true }),
  openingFloatCents: centsSchema,
  closedBy: z.string().nullable(),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.string().nullable(),
  version: z.number().int(),
  paymentCount: z.number().int(),
  /** Pagamentos ativos recebidos neste caixa. */
  received: methodTotalsSchema,
  withdrawalsCents: centsSchema,
  reinforcementsCents: centsSchema,
  /** Dinheiro = fundo + recebido + suprimentos − sangrias. Congelado no fechamento. */
  expected: methodTotalsSchema,
  /** O que o operador contou (só depois de fechado). */
  counted: methodTotalsSchema.nullable(),
  /** Contado − esperado: negativo = faltou. */
  difference: methodTotalsSchema.nullable(),
  movements: z.array(cashMovementSchema),
});
export type CashSession = z.infer<typeof cashSessionSchema>;

export const currentCashSchema = z.object({
  session: cashSessionSchema.nullable(),
});
export type CurrentCash = z.infer<typeof currentCashSchema>;

export const openCashSchema = z.object({
  operator: operatorSchema,
  /** Fundo de troco contado na abertura. */
  openingFloatCents: centsSchema,
});
export type OpenCashInput = z.input<typeof openCashSchema>;

export const addCashMovementSchema = z.object({
  kind: cashMovementKindSchema,
  amountCents: centsSchema.refine((v) => v > 0, 'Informe um valor.'),
  reason: z.string().trim().min(3).max(300),
  operator: operatorSchema.nullable().default(null),
});
export type AddCashMovementInput = z.input<typeof addCashMovementSchema>;

/** Fechamento cego: o que foi contado em cada forma, sem ver o esperado. */
export const closeCashSchema = z.object({
  version: z.number().int().positive(),
  operator: operatorSchema,
  counted: z.object({
    cash: centsSchema,
    credit: centsSchema,
    debit: centsSchema,
    pix: centsSchema,
  }),
  notes: z.string().trim().max(500).nullable().default(null),
});
export type CloseCashInput = z.input<typeof closeCashSchema>;

export const listCashSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
