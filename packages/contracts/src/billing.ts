import { z } from 'zod';
import { centsSchema } from './money.js';

export const paymentMethodSchema = z.enum(['cash', 'credit', 'debit', 'pix']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'PIX',
};

export const paymentStatusSchema = z.enum(['active', 'canceled']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

const reasonSchema = z.string().trim().min(3).max(300);

export const paymentSchema = z.object({
  id: z.uuid(),
  tabId: z.uuid(),
  method: paymentMethodSchema,
  /** Quanto abate da conta. */
  amountCents: centsSchema,
  /** Só em dinheiro: valor entregue pelo cliente. */
  receivedCents: centsSchema.nullable(),
  changeCents: centsSchema,
  status: paymentStatusSchema,
  cancelReason: z.string().nullable(),
  canceledAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Payment = z.infer<typeof paymentSchema>;

/**
 * O valor não pode passar do saldo. Em dinheiro, `receivedCents` (opcional)
 * é o que o cliente entregou e define o troco.
 */
export const addPaymentSchema = z
  .object({
    method: paymentMethodSchema,
    amountCents: centsSchema.refine(
      (v) => v > 0,
      'Informe um valor maior que zero.',
    ),
    receivedCents: centsSchema.optional(),
  })
  .refine((p) => p.receivedCents === undefined || p.method === 'cash', {
    message: 'Valor recebido só se aplica a dinheiro.',
    path: ['receivedCents'],
  })
  .refine(
    (p) => p.receivedCents === undefined || p.receivedCents >= p.amountCents,
    {
      message: 'Valor recebido menor que o valor do pagamento.',
      path: ['receivedCents'],
    },
  );
export type AddPaymentInput = z.input<typeof addPaymentSchema>;

/** Estorno de pagamento lançado errado. */
export const cancelPaymentSchema = z.object({ reason: reasonSchema });
export type CancelPaymentInput = z.input<typeof cancelPaymentSchema>;

/** RN04: encerra só com saldo zero; `version` garante que o caixa viu a conta atual. */
export const closeTabSchema = z.object({
  version: z.number().int().positive(),
});
export type CloseTabInput = z.input<typeof closeTabSchema>;

/** Libera a mesa cancelando uma comanda sem consumo (aberta por engano ou cliente foi embora). */
export const cancelTabSchema = z.object({ reason: reasonSchema });
export type CancelTabInput = z.input<typeof cancelTabSchema>;
