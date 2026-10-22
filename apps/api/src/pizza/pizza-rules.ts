import { errorCodes, type OrderItemFlavor } from '@muquifo/contracts';
import { HttpStatus } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AppException } from '../common/app-exception.js';
import type { Executor } from '../db/client.js';
import { pizzaFlavors, pizzaTierPrices, pizzaTiers } from '../db/schema.js';

type PizzaRef = { id: string; name: string; maxFlavors: number | null };

/**
 * Confere os sabores contra o tamanho e devolve o que vai gravado no item
 * (na ordem escolhida) e o preço: o da faixa mais cara entre os sabores.
 */
export async function resolveFlavors(
  db: Executor,
  product: PizzaRef,
  flavorIds: string[],
): Promise<{ selected: OrderItemFlavor[]; priceCents: number }> {
  if (product.maxFlavors === null) {
    if (flavorIds.length === 0) return { selected: [], priceCents: 0 };
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.invalidFlavors,
      `${product.name} não é pizza; não aceita sabores.`,
      { productId: product.id, flavorIds },
    );
  }
  if (flavorIds.length < 1 || flavorIds.length > product.maxFlavors) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.invalidFlavors,
      product.maxFlavors === 1
        ? `${product.name}: escolha 1 sabor.`
        : `${product.name}: escolha de 1 a ${product.maxFlavors} sabores.`,
      {
        productId: product.id,
        maxFlavors: product.maxFlavors,
        selected: flavorIds.length,
      },
    );
  }

  const rows = await db
    .select({
      id: pizzaFlavors.id,
      name: pizzaFlavors.name,
      available: pizzaFlavors.available,
      tierName: pizzaTiers.name,
      priceCents: pizzaTierPrices.priceCents,
    })
    .from(pizzaFlavors)
    .innerJoin(pizzaTiers, eq(pizzaTiers.id, pizzaFlavors.tierId))
    // Sem preço no tamanho = sabor não sai nele.
    .innerJoin(
      pizzaTierPrices,
      and(
        eq(pizzaTierPrices.tierId, pizzaTiers.id),
        eq(pizzaTierPrices.productId, product.id),
      ),
    )
    .where(
      and(
        inArray(pizzaFlavors.id, flavorIds),
        eq(pizzaFlavors.active, true),
        eq(pizzaTiers.active, true),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const invalid = flavorIds.filter((id) => !byId.has(id));
  if (invalid.length > 0) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.invalidFlavors,
      `Sabor que saiu do cardápio ou não é vendido em ${product.name}.`,
      { productId: product.id, flavorIds: invalid },
    );
  }
  const unavailable = rows.filter((r) => !r.available);
  if (unavailable.length > 0) {
    throw new AppException(
      HttpStatus.CONFLICT,
      errorCodes.flavorUnavailable,
      `${unavailable.map((r) => r.name).join(', ')} em falta no momento.`,
      { productId: product.id, flavorIds: unavailable.map((r) => r.id) },
    );
  }

  const selected = flavorIds.map((id) => {
    const r = byId.get(id)!;
    return {
      flavorId: r.id,
      name: r.name,
      tierName: r.tierName,
      priceCents: r.priceCents,
    };
  });
  return {
    selected,
    priceCents: Math.max(...selected.map((f) => f.priceCents)),
  };
}
