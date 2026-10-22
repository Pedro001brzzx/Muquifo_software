import {
  type adjustmentInputSchema,
  errorCodes,
  type OrderItemAdjustment,
  type OrderItemOption,
} from '@muquifo/contracts';
import { HttpStatus } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Executor } from '../db/client.js';
import {
  categoryOptionGroups,
  ingredients,
  optionGroups,
  options,
  productExcludedOptionGroups,
  productIngredients,
  productOptionGroups,
} from '../db/schema.js';

type GroupRow = typeof optionGroups.$inferSelect;
type OptionRow = typeof options.$inferSelect;
type ProductRef = { id: string; categoryId: string; name: string };

/** Profundidade máxima de grupos encadeados (Combo → Bebida → …). */
const MAX_DEPTH = 3;

/**
 * Grupos que valem para o produto: primeiro os da categoria (menos os
 * desligados no produto), depois os do próprio produto, sem repetir.
 * Grupos arquivados não contam.
 */
export async function effectiveGroups(
  db: Executor,
  product: { id: string; categoryId: string },
): Promise<GroupRow[]> {
  const [fromCategory, fromProduct, excluded] = await Promise.all([
    db
      .select({ group: optionGroups })
      .from(categoryOptionGroups)
      .innerJoin(
        optionGroups,
        eq(optionGroups.id, categoryOptionGroups.groupId),
      )
      .where(
        and(
          eq(categoryOptionGroups.categoryId, product.categoryId),
          eq(optionGroups.active, true),
        ),
      )
      .orderBy(asc(categoryOptionGroups.sortOrder)),
    db
      .select({ group: optionGroups })
      .from(productOptionGroups)
      .innerJoin(optionGroups, eq(optionGroups.id, productOptionGroups.groupId))
      .where(
        and(
          eq(productOptionGroups.productId, product.id),
          eq(optionGroups.active, true),
        ),
      )
      .orderBy(asc(productOptionGroups.sortOrder)),
    db
      .select({ groupId: productExcludedOptionGroups.groupId })
      .from(productExcludedOptionGroups)
      .where(eq(productExcludedOptionGroups.productId, product.id)),
  ]);
  const off = new Set(excluded.map((e) => e.groupId));
  const seen = new Set<string>();
  return [...fromCategory.filter((r) => !off.has(r.group.id)), ...fromProduct]
    .map((r) => r.group)
    .filter((g) => !seen.has(g.id) && seen.add(g.id));
}

/**
 * Confere as escolhas contra os grupos do produto e devolve o que vai gravado
 * no item (nome e preço de agora, RN02) e o acréscimo no preço. Um grupo
 * filho só vale (e só é exigido) quando a opção que o abre foi escolhida.
 */
export async function resolveOptions(
  db: Executor,
  product: ProductRef,
  optionIds: string[],
): Promise<{ selected: OrderItemOption[]; extraCents: number }> {
  const topLevel = await effectiveGroups(db, product);
  if (topLevel.length === 0 && optionIds.length === 0) {
    return { selected: [], extraCents: 0 };
  }

  const rows: OptionRow[] = optionIds.length
    ? await db
        .select()
        .from(options)
        .where(and(inArray(options.id, optionIds), eq(options.active, true)))
    : [];

  // Ativa os grupos filhos das opções escolhidas, nível por nível.
  const groups: GroupRow[] = [...topLevel];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const childIds = rows
      .filter((o) => groupById.has(o.groupId) && o.childGroupId)
      .map((o) => o.childGroupId as string)
      .filter((id) => !groupById.has(id));
    if (childIds.length === 0) break;
    const children = await db
      .select()
      .from(optionGroups)
      .where(
        and(inArray(optionGroups.id, childIds), eq(optionGroups.active, true)),
      );
    for (const child of children) {
      groups.push(child);
      groupById.set(child.id, child);
    }
  }

  const invalid = optionIds.filter(
    (id) => !rows.some((o) => o.id === id && groupById.has(o.groupId)),
  );
  if (invalid.length > 0) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.invalidOptions,
      `Complemento que não pertence a ${product.name} ou saiu do cardápio.`,
      { productId: product.id, optionIds: invalid },
    );
  }
  const unavailable = rows.filter((o) => !o.available);
  if (unavailable.length > 0) {
    throw new AppException(
      HttpStatus.CONFLICT,
      errorCodes.optionUnavailable,
      `${unavailable.map((o) => o.name).join(', ')} em falta no momento.`,
      { productId: product.id, optionIds: unavailable.map((o) => o.id) },
    );
  }

  for (const group of groups) {
    const count = rows.filter((o) => o.groupId === group.id).length;
    if (count < group.minSelect || count > group.maxSelect) {
      const rule =
        group.minSelect === group.maxSelect
          ? `exatamente ${group.minSelect}`
          : group.minSelect > 0
            ? `de ${group.minSelect} a ${group.maxSelect}`
            : `até ${group.maxSelect}`;
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.invalidOptions,
        `${product.name}: escolha ${rule} em "${group.name}".`,
        {
          productId: product.id,
          groupId: group.id,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          selected: count,
        },
      );
    }
  }

  // Ordem do cardápio: grupo (filhos depois dos pais) e depois opção.
  const groupOrder = new Map(groups.map((g, i) => [g.id, i]));
  const selected = rows
    .sort(
      (a, b) =>
        (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) ||
        a.sortOrder - b.sortOrder,
    )
    .map((o) => ({
      optionId: o.id,
      groupName: groupById.get(o.groupId)?.name ?? '',
      name: o.name,
      priceCents: o.priceCents,
    }));
  return {
    selected,
    extraCents: selected.reduce((sum, o) => sum + o.priceCents, 0),
  };
}

/** Sem/Pouco/Extra só em ingrediente ajustável da receita deste produto. */
export async function resolveAdjustments(
  db: Executor,
  product: ProductRef,
  input: z.output<typeof adjustmentInputSchema>[],
): Promise<OrderItemAdjustment[]> {
  if (input.length === 0) return [];
  const recipe = await db
    .select({
      ingredientId: productIngredients.ingredientId,
      adjustable: productIngredients.adjustable,
      sortOrder: productIngredients.sortOrder,
      name: ingredients.name,
    })
    .from(productIngredients)
    .innerJoin(ingredients, eq(ingredients.id, productIngredients.ingredientId))
    .where(eq(productIngredients.productId, product.id));
  const byId = new Map(recipe.map((r) => [r.ingredientId, r]));
  const invalid = input.filter((a) => !byId.get(a.ingredientId)?.adjustable);
  if (invalid.length > 0) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.invalidAdjustments,
      `Ingrediente que não está em ${product.name} ou não pode ser ajustado.`,
      {
        productId: product.id,
        ingredientIds: invalid.map((a) => a.ingredientId),
      },
    );
  }
  return input
    .map((a) => ({ ...a, ingredient: byId.get(a.ingredientId)! }))
    .sort((a, b) => a.ingredient.sortOrder - b.ingredient.sortOrder)
    .map((a) => ({
      ingredientId: a.ingredientId,
      name: a.ingredient.name,
      kind: a.kind,
    }));
}
