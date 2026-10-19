import { z } from 'zod';
import { paymentSchema } from './billing.js';
import { centsSchema } from './money.js';

export const tabStatusSchema = z.enum([
  'open',
  'closing',
  'closed',
  'canceled',
]);
export type TabStatus = z.infer<typeof tabStatusSchema>;

export const orderStatusSchema = z.enum(['draft', 'submitted', 'canceled']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderChannelSchema = z.enum([
  'table',
  'counter',
  'pickup',
  'delivery',
]);
export type OrderChannel = z.infer<typeof orderChannelSchema>;

export const orderItemStatusSchema = z.enum(['active', 'canceled']);
export type OrderItemStatus = z.infer<typeof orderItemStatusSchema>;

/** Até 3 casas decimais; frações só para produtos que as permitem (RN01). */
export const quantitySchema = z
  .number()
  .positive()
  .max(9999)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, {
    message: 'Use no máximo 3 casas decimais.',
  });

const notesSchema = z.string().trim().max(300).nullable().default(null);
const reasonSchema = z.string().trim().min(3).max(300);

// ---------- Comandas ----------

export const openTabSchema = z.object({
  tableId: z.uuid().nullable().default(null),
  customerName: z.string().trim().min(1).max(120).nullable().default(null),
});
export type OpenTabInput = z.input<typeof openTabSchema>;

export const listTabsQuerySchema = z.object({
  status: tabStatusSchema.optional(),
  tableId: z.uuid().optional(),
});

export const tabSummarySchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  tableId: z.uuid().nullable(),
  tableNumber: z.number().int().nullable(),
  customerName: z.string().nullable(),
  status: tabStatusSchema,
  version: z.number().int(),
  openedAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Soma dos itens ativos de pedidos enviados. */
  totalCents: centsSchema,
  itemCount: z.number().int(),
});
export type TabSummary = z.infer<typeof tabSummarySchema>;

// ---------- Pedidos ----------

export const orderItemSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  productId: z.uuid(),
  /** Nome e preço registrados no momento da venda (RN02). */
  productName: z.string(),
  unitPriceCents: centsSchema,
  quantity: z.number(),
  totalCents: centsSchema,
  sectorId: z.uuid().nullable(),
  notes: z.string().nullable(),
  status: orderItemStatusSchema,
  cancelReason: z.string().nullable(),
  canceledAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  tabId: z.uuid(),
  channel: orderChannelSchema,
  status: orderStatusSchema,
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  canceledAt: z.iso.datetime({ offset: true }).nullable(),
  cancelReason: z.string().nullable(),
  /** Soma dos itens ativos. */
  totalCents: centsSchema,
  items: z.array(orderItemSchema),
});
export type Order = z.infer<typeof orderSchema>;

export const tabDetailSchema = tabSummarySchema.extend({
  /** Itens ativos ainda em rascunho (não enviados à produção). */
  draftCents: centsSchema,
  /** Soma dos pagamentos ativos. */
  paidCents: centsSchema,
  /** Total menos pago; negativo se um item foi cancelado depois de pago (estorne o excesso). */
  balanceCents: z.number().int(),
  cancelReason: z.string().nullable(),
  canceledAt: z.iso.datetime({ offset: true }).nullable(),
  orders: z.array(orderSchema),
  payments: z.array(paymentSchema),
});
export type TabDetail = z.infer<typeof tabDetailSchema>;

export const addOrderItemSchema = z.object({
  productId: z.uuid(),
  quantity: quantitySchema.default(1),
  notes: notesSchema,
  /**
   * Preço que o aparelho exibiu ao montar o pedido. Se o preço atual for outro,
   * a API recusa com PRICE_CHANGED em vez de cobrar um valor que o cliente não viu.
   */
  expectedUnitPriceCents: centsSchema.optional(),
});
export type AddOrderItemInput = z.input<typeof addOrderItemSchema>;

export const createOrderSchema = z.object({
  tabId: z.uuid(),
  channel: orderChannelSchema,
  notes: notesSchema,
  items: z.array(addOrderItemSchema).max(100).default([]),
  /** Envia à produção na mesma operação (útil para a fila offline do APK). */
  submit: z.boolean().default(false),
});
export type CreateOrderInput = z.input<typeof createOrderSchema>;

/** `version` garante que o pedido enviado é o mesmo que foi revisado. */
export const submitOrderSchema = z.object({
  version: z.number().int().positive(),
});
export type SubmitOrderInput = z.input<typeof submitOrderSchema>;

/** Sem `itemIds`, cancela o pedido inteiro. Motivo é obrigatório (RN05). */
export const cancelOrderSchema = z.object({
  reason: reasonSchema,
  itemIds: z.array(z.uuid()).min(1).max(100).optional(),
});
export type CancelOrderInput = z.input<typeof cancelOrderSchema>;

// ---------- Operações idempotentes ----------

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const operationSchema = z.object({
  operationId: z.uuid(),
  scope: z.string(),
  statusCode: z.number().int(),
  response: z.unknown(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Operation = z.infer<typeof operationSchema>;
