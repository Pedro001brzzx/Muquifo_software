import {
  type addPaymentSchema,
  type cancelPaymentSchema,
  type cancelTabSchema,
  type closeTabSchema,
  errorCodes,
  formatCents,
  type TabDetail,
} from '@muquifo/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { lockOpenSession } from '../cash/cash.service.js';
import { AppException } from '../common/app-exception.js';
import type { Transaction } from '../db/client.js';
import { orderItems, orders, payments, tabs } from '../db/schema.js';
import { getTab, lockTab, tabBalance, touchTab } from './ordering.queries.js';
import { assertTabAccepts } from './tab-rules.js';

/** Cancela os rascunhos da comanda (e seus itens), que nunca foram à produção. */
async function cancelDrafts(tx: Transaction, tabId: string, reason: string) {
  const drafts = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tabId, tabId), eq(orders.status, 'draft')));
  if (drafts.length === 0) return;
  const ids = drafts.map((d) => d.id);
  const now = new Date();
  await tx
    .update(orderItems)
    .set({ status: 'canceled', cancelReason: reason, canceledAt: now })
    .where(
      and(inArray(orderItems.orderId, ids), eq(orderItems.status, 'active')),
    );
  await tx
    .update(orders)
    .set({ status: 'canceled', cancelReason: reason, canceledAt: now })
    .where(inArray(orders.id, ids));
}

@Injectable()
export class BillingService {
  /**
   * RF07: pagamento manual. Nunca passa do saldo; em dinheiro calcula o troco.
   * Só com caixa aberto: o pagamento fica no caixa do turno.
   */
  async addPayment(
    tx: Transaction,
    tabId: string,
    input: z.output<typeof addPaymentSchema>,
  ): Promise<TabDetail> {
    const tab = await lockTab(tx, tabId);
    assertTabAccepts(tab, 'settle');
    const session = await lockOpenSession(tx);
    const { balanceCents } = await tabBalance(tx, tab.id);
    if (input.amountCents > balanceCents) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.paymentExceedsBalance,
        balanceCents > 0
          ? `O pagamento passa do saldo de ${formatCents(balanceCents)}.`
          : 'A comanda não tem saldo a pagar.',
        { balanceCents },
      );
    }
    await tx.insert(payments).values({
      tabId: tab.id,
      method: input.method,
      amountCents: input.amountCents,
      receivedCents: input.receivedCents ?? null,
      changeCents:
        input.receivedCents === undefined
          ? 0
          : input.receivedCents - input.amountCents,
      cashSessionId: session.id,
    });
    await touchTab(tx, tab.id);
    return getTab(tx, tab.id);
  }

  /** Estorno de pagamento lançado errado: fica registrado com motivo (RN05). */
  async cancelPayment(
    tx: Transaction,
    tabId: string,
    paymentId: string,
    input: z.output<typeof cancelPaymentSchema>,
  ): Promise<TabDetail> {
    const tab = await lockTab(tx, tabId);
    assertTabAccepts(tab, 'settle');
    const updated = await tx
      .update(payments)
      .set({
        status: 'canceled',
        cancelReason: input.reason,
        canceledAt: new Date(),
      })
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.tabId, tab.id),
          eq(payments.status, 'active'),
        ),
      )
      .returning({ id: payments.id });
    if (updated.length === 0) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        'Pagamento inexistente, de outra comanda ou já estornado.',
        { paymentId },
      );
    }
    await touchTab(tx, tab.id);
    return getTab(tx, tab.id);
  }

  /**
   * RN04: encerra a conta só com saldo zero e sem rascunho com itens.
   * A trava da comanda e a `version` impedem fechar com um lançamento concorrente.
   * A mesa fica livre porque o status dela vem das comandas abertas.
   */
  async close(
    tx: Transaction,
    tabId: string,
    input: z.output<typeof closeTabSchema>,
  ): Promise<TabDetail> {
    const tab = await lockTab(tx, tabId);
    assertTabAccepts(tab, 'settle');
    if (tab.version !== input.version) {
      throw AppException.versionConflict('Comanda', tab.version);
    }
    const balance = await tabBalance(tx, tab.id);
    if (balance.draftItems > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.draftOrdersPending,
        'Há pedidos em rascunho com itens. Envie ou cancele antes de fechar a conta.',
        { draftItems: balance.draftItems },
      );
    }
    if (balance.totalCents === 0 && balance.paidCents === 0) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.tabEmpty,
        'Comanda sem consumo. Use "Liberar mesa" para cancelá-la.',
      );
    }
    if (balance.balanceCents !== 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.balanceNotZero,
        balance.balanceCents > 0
          ? `Ainda faltam ${formatCents(balance.balanceCents)} para fechar a conta.`
          : `Pagamentos passam do total em ${formatCents(-balance.balanceCents)}. Estorne o excesso.`,
        { balanceCents: balance.balanceCents },
      );
    }
    await cancelDrafts(tx, tab.id, 'Comanda encerrada');
    await tx
      .update(tabs)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(tabs.id, tab.id));
    await touchTab(tx, tab.id);
    return getTab(tx, tab.id);
  }

  /**
   * Libera a mesa cancelando uma comanda sem consumo enviado nem pagamento
   * (aberta por engano, cliente foi embora). Rascunhos são cancelados junto.
   */
  async cancelTab(
    tx: Transaction,
    tabId: string,
    input: z.output<typeof cancelTabSchema>,
  ): Promise<TabDetail> {
    const tab = await lockTab(tx, tabId);
    assertTabAccepts(tab, 'settle');
    const balance = await tabBalance(tx, tab.id);
    if (balance.totalCents > 0 || balance.paidCents > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.tabHasConsumption,
        'A comanda tem consumo ou pagamento. Feche a conta, ou cancele os itens e estorne os pagamentos antes.',
        { totalCents: balance.totalCents, paidCents: balance.paidCents },
      );
    }
    await cancelDrafts(tx, tab.id, input.reason);
    await tx
      .update(tabs)
      .set({
        status: 'canceled',
        cancelReason: input.reason,
        canceledAt: new Date(),
      })
      .where(eq(tabs.id, tab.id));
    await touchTab(tx, tab.id);
    return getTab(tx, tab.id);
  }
}
