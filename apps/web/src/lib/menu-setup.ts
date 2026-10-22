import type { Category, ProductionSector } from '@muquifo/contracts';
import { api } from '@/api';
import { type ItemKind, kindOfCategory } from '@/lib/figures';

/** Nome da categoria criada quando ainda não há uma do tipo. */
export const kindCategory: Record<ItemKind, string> = {
  burger: 'Lanches',
  pizza: 'Pizzas',
  drink: 'Bebidas',
  side: 'Porções',
  dessert: 'Sobremesas',
  dish: 'Pratos',
  other: 'Outros',
};

/**
 * Categoria do tipo: uma ativa que combine pelo nome, ou uma nova. `known`
 * evita recriar quando várias são resolvidas em sequência (o cache não
 * atualiza no meio do laço).
 */
export async function ensureCategory(
  kind: ItemKind,
  known: Category[],
): Promise<Category> {
  const found =
    known.find((c) => c.active && kindOfCategory(c.name) === kind) ??
    known.find((c) => c.active && c.name === kindCategory[kind]);
  if (found) return found;
  const created = await api.createCategory({ name: kindCategory[kind] });
  known.push(created);
  return created;
}

/** Bebida sai no bar; o resto, na cozinha (se esses setores existirem). */
export const sectorFor = (kind: ItemKind, sectors: ProductionSector[] = []) =>
  sectors.find((s) =>
    (kind === 'drink' ? /bar|copa|bebida/i : /cozinha/i).test(s.name),
  )?.id ?? null;
