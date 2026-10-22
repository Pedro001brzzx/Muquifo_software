import {
  type addOrderItemSchema,
  type cancelOrderSchema,
  type createOrderSchema,
  errorCodes,
  type Order,
  type submitOrderSchema,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import {
  orderItemAdjustments,
  orderItemFlavors,
  orderItemOptions,
  orderItems,
  orders,
  products,
} from '../db/schema.js';
import { resolveAdjustments, resolveOptions } from '../options/option-rules.js';
import { resolveFlavors } from '../pizza/pizza-rules.js';
import {
  getOrder,
  lockOrderWithTab,
  lockTab,
  touchOrder,
  touchTab,
} from './ordering.queries.js';
import { assertTabAccepts } from './tab-rules.js';

type OrderRow = typeof orders.$inferSelect;
type ItemInput = z.output<typeof addOrderItemSchema>;

function assertDraft(order: OrderRow): void {
  if (order.status !== 'draft') {
    throw new AppException(
      HttpStatus.CONFLICT,
      errorCodes.orderNotEditable,
      `Pedido ${order.number} já foi ${order.status === 'submitted' ? 'enviado' : 'cancelado'}. Use cancelamento ou um novo pedido.`,
      { orderId: order.id, status: order.status },
    );
  }
}

@Injectable()
export class OrdersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  get(id: string): Promise<Order> {
    return getOrder(this.db, id);
  }

  async create(
    tx: Transaction,
    input: z.output<typeof createOrderSchema>,
  ): Promise<Order> {
    const tab = await lockTab(tx, input.tabId);
    assertTabAccepts(tab, 'order');
    if (input.channel === 'table' && !tab.tableId) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        'Pedido de mesa exige uma comanda vinculada a uma mesa.',
        { tabId: tab.id },
      );
    }

    const [order] = await tx
      .insert(orders)
      .values({ tabId: tab.id, channel: input.channel, notes: input.notes })
      .returning();
    for (const item of input.items) {
      await this.insertItem(tx, order.id, item);
    }
    if (input.submit) {
      await this.markSubmitted(tx, order.id);
    }
    await touchTab(tx, tab.id);
    return getOrder(tx, order.id);
  }

  async addItem(
    tx: Transaction,
    orderId: string,
    input: ItemInput,
  ): Promise<Order> {
    const { order, tab } = await lockOrderWithTab(tx, orderId);
    assertTabAccepts(tab, 'order');
    assertDraft(order);
    await this.insertItem(tx, order.id, input);
    await touchOrder(tx, order.id);
    await touchTab(tx, tab.id);
    return getOrder(tx, order.id);
  }

  /** Só rascunhos: item ainda não enviado pode sair sem deixar rastro. */
  async removeItem(
    tx: Transaction,
    orderId: string,
    itemId: string,
  ): Promise<Order> {
    const { order, tab } = await lockOrderWithTab(tx, orderId);
    assertTabAccepts(tab, 'order');
    assertDraft(order);
    const ownItem = sql`(select ${orderItems.id} from ${orderItems} where ${orderItems.id} = ${itemId} and ${orderItems.orderId} = ${order.id})`;
    await tx
      .delete(orderItemOptions)
      .where(sql`${orderItemOptions.orderItemId} in ${ownItem}`);
    await tx
      .delete(orderItemAdjustments)
      .where(sql`${orderItemAdjustments.orderItemId} in ${ownItem}`);
    await tx
      .delete(orderItemFlavors)
      .where(sql`${orderItemFlavors.orderItemId} in ${ownItem}`);
    const deleted = await tx
      .delete(orderItems)
      .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, order.id)))
      .returning({ id: orderItems.id });
    if (deleted.length === 0) throw AppException.notFound('Item', itemId);
    await touchOrder(tx, order.id);
    await touchTab(tx, tab.id);
    return getOrder(tx, order.id);
  }

  async submit(
    tx: Transaction,
    orderId: string,
    input: z.output<typeof submitOrderSchema>,
  ): Promise<Order> {
    const { order, tab } = await lockOrderWithTab(tx, orderId);
    assertTabAccepts(tab, 'order');
    assertDraft(order);
    if (order.version !== input.version) {
      throw AppException.versionConflict('Pedido', order.version);
    }
    await this.markSubmitted(tx, order.id);
    await touchTab(tx, tab.id);
    return getOrder(tx, order.id);
  }

  /**
   * RN05: pedido enviado nunca é apagado. O cancelamento marca os itens com motivo
   * e horário; se nenhum item ativo restar, o pedido inteiro fica cancelado.
   * Não estorna pagamentos.
   */
  async cancel(
    tx: Transaction,
    orderId: string,
    input: z.output<typeof cancelOrderSchema>,
  ): Promise<Order> {
    const { order, tab } = await lockOrderWithTab(tx, orderId);
    // Comanda em fechamento ainda aceita cancelamentos, mas não novos itens.
    assertTabAccepts(tab, 'settle');
    if (order.status === 'canceled') {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.orderNotEditable,
        `Pedido ${order.number} já está cancelado.`,
        { orderId: order.id },
      );
    }

    const active = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(
        and(eq(orderItems.orderId, order.id), eq(orderItems.status, 'active')),
      );
    const activeIds = new Set(active.map((i) => i.id));
    const targetIds = input.itemIds ?? [...activeIds];
    const invalid = targetIds.filter((id) => !activeIds.has(id));
    if (invalid.length > 0) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        'Itens inexistentes, de outro pedido ou já cancelados.',
        { itemIds: invalid },
      );
    }

    const now = new Date();
    if (targetIds.length > 0) {
      await tx
        .update(orderItems)
        .set({
          status: 'canceled',
          cancelReason: input.reason,
          canceledAt: now,
        })
        .where(inArray(orderItems.id, targetIds));
    }
    if (activeIds.size === targetIds.length) {
      await tx
        .update(orders)
        .set({
          status: 'canceled',
          cancelReason: input.reason,
          canceledAt: now,
        })
        .where(eq(orders.id, order.id));
    }
    await touchOrder(tx, order.id);
    await touchTab(tx, tab.id);
    // TODO(produção): avisar a produção sobre itens cancelados já enviados.
    return getOrder(tx, order.id);
  }

  /** RF05: preço e regras validados no servidor; nome, preço e setor viram histórico. */
  private async insertItem(
    tx: Transaction,
    orderId: string,
    input: ItemInput,
  ): Promise<void> {
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, input.productId));
    if (!product) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        'Produto inexistente.',
        { productId: input.productId },
      );
    }
    if (!product.available || !product.active) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.productUnavailable,
        product.active
          ? `${product.name} está indisponível no momento.`
          : `${product.name} saiu do cardápio.`,
        { productId: product.id },
      );
    }
    if (!product.allowFractional && !Number.isInteger(input.quantity)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        `${product.name} só aceita quantidade inteira.`,
        { productId: product.id, quantity: input.quantity },
      );
    }
    const { selected, extraCents } = await resolveOptions(
      tx,
      product,
      input.optionIds,
    );
    const adjustments = await resolveAdjustments(
      tx,
      product,
      input.adjustments,
    );
    const flavors = await resolveFlavors(tx, product, input.flavorIds);
    // Preço unitário = produto + sabor mais caro + complementos; é o que o
    // aparelho deve ter exibido.
    const unitPriceCents = product.priceCents + flavors.priceCents + extraCents;
    if (
      input.expectedUnitPriceCents !== undefined &&
      input.expectedUnitPriceCents !== unitPriceCents
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        errorCodes.priceChanged,
        `O preço de ${product.name} mudou. Revise o pedido.`,
        {
          productId: product.id,
          expectedUnitPriceCents: input.expectedUnitPriceCents,
          currentUnitPriceCents: unitPriceCents,
        },
      );
    }
    const [item] = await tx
      .insert(orderItems)
      .values({
        orderId,
        productId: product.id,
        productName: product.name,
        unitPriceCents,
        quantity: input.quantity,
        totalCents: Math.round(unitPriceCents * input.quantity),
        sectorId: product.sectorId,
        notes: input.notes,
      })
      .returning({ id: orderItems.id });
    if (selected.length) {
      await tx.insert(orderItemOptions).values(
        selected.map((o, i) => ({
          orderItemId: item.id,
          optionId: o.optionId,
          groupName: o.groupName,
          name: o.name,
          priceCents: o.priceCents,
          sortOrder: i,
        })),
      );
    }
    if (adjustments.length) {
      await tx.insert(orderItemAdjustments).values(
        adjustments.map((a, i) => ({
          orderItemId: item.id,
          ingredientId: a.ingredientId,
          ingredientName: a.name,
          kind: a.kind,
          sortOrder: i,
        })),
      );
    }
    if (flavors.selected.length) {
      await tx.insert(orderItemFlavors).values(
        flavors.selected.map((f, i) => ({
          orderItemId: item.id,
          flavorId: f.flavorId,
          name: f.name,
          tierName: f.tierName,
          priceCents: f.priceCents,
          sortOrder: i,
        })),
      );
    }
  }

  private async markSubmitted(tx: Transaction, orderId: string): Promise<void> {
    const items = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(
        and(eq(orderItems.orderId, orderId), eq(orderItems.status, 'active')),
      )
      .limit(1);
    if (items.length === 0) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.emptyOrder,
        'Pedido sem itens não pode ser enviado.',
        { orderId },
      );
    }
    await tx
      .update(orders)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(eq(orders.id, orderId));
    await touchOrder(tx, orderId);
    // TODO(produção): gerar tickets por setor e emitir order.submitted.
  }
}
