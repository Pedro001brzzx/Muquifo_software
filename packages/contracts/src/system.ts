import { z } from 'zod';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  version: z.string(),
  serverTime: z.iso.datetime({ offset: true }),
});
export type Health = z.infer<typeof healthSchema>;

/** Formato único de erro da API (seção 09 do documento de requisitos). */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const errorCodes = {
  validation: 'VALIDATION_FAILED',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  versionConflict: 'VERSION_CONFLICT',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  internal: 'INTERNAL_ERROR',
  idempotencyKeyRequired: 'IDEMPOTENCY_KEY_REQUIRED',
  idempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
  tabNotOpen: 'TAB_NOT_OPEN',
  orderNotEditable: 'ORDER_NOT_EDITABLE',
  emptyOrder: 'EMPTY_ORDER',
  productUnavailable: 'PRODUCT_UNAVAILABLE',
  priceChanged: 'PRICE_CHANGED',
  paymentExceedsBalance: 'PAYMENT_EXCEEDS_BALANCE',
  balanceNotZero: 'BALANCE_NOT_ZERO',
  draftOrdersPending: 'DRAFT_ORDERS_PENDING',
  tabEmpty: 'TAB_EMPTY',
  tabHasConsumption: 'TAB_HAS_CONSUMPTION',
} as const;
