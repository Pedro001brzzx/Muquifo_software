import {
  type Category,
  type createCategorySchema,
  type createProductSchema,
  errorCodes,
  type listProductsQuerySchema,
  type Product,
  type ProductionSector,
  type updateCategorySchema,
  type updateProductAvailabilitySchema,
  type updateProductSchema,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Executor, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import {
  categories,
  categoryOptionGroups,
  ingredients,
  productExcludedOptionGroups,
  productIngredients,
  productionSectors,
  productOptionGroups,
  products,
} from '../db/schema.js';

const categoryColumns = {
  id: categories.id,
  name: categories.name,
  sortOrder: categories.sortOrder,
  active: categories.active,
};

const productColumns = {
  id: products.id,
  categoryId: products.categoryId,
  sectorId: products.sectorId,
  code: products.code,
  name: products.name,
  description: products.description,
  priceCents: products.priceCents,
  available: products.available,
  allowFractional: products.allowFractional,
  active: products.active,
  maxFlavors: products.maxFlavors,
  icon: products.icon,
  version: products.version,
  updatedAt: products.updatedAt,
};

type ProductRow = Omit<
  Product,
  'updatedAt' | 'optionGroupIds' | 'excludedOptionGroupIds' | 'ingredients'
> & {
  updatedAt: Date;
};
type IngredientsInput = { ingredientId: string; adjustable: boolean }[];
type CategoryRow = Omit<Category, 'optionGroupIds'>;

/** Grupos ligados, por dono (produto ou categoria), na ordem de exibição. */
async function linksFor(
  db: Executor,
  table: typeof productOptionGroups | typeof categoryOptionGroups,
  ownerIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ownerIds.length === 0) return map;
  const owner = 'productId' in table ? table.productId : table.categoryId;
  const rows = await db
    .select({ owner, groupId: table.groupId })
    .from(table)
    .where(inArray(owner, ownerIds))
    .orderBy(asc(table.sortOrder));
  for (const r of rows)
    map.set(r.owner, [...(map.get(r.owner) ?? []), r.groupId]);
  return map;
}

async function withProductLinks(
  db: Executor,
  rows: ProductRow[],
): Promise<Product[]> {
  const ids = rows.map((r) => r.id);
  const [links, excluded, recipe] = await Promise.all([
    linksFor(db, productOptionGroups, ids),
    ids.length
      ? db
          .select()
          .from(productExcludedOptionGroups)
          .where(inArray(productExcludedOptionGroups.productId, ids))
      : [],
    ids.length
      ? db
          .select({
            productId: productIngredients.productId,
            ingredientId: productIngredients.ingredientId,
            name: ingredients.name,
            adjustable: productIngredients.adjustable,
          })
          .from(productIngredients)
          .innerJoin(
            ingredients,
            eq(ingredients.id, productIngredients.ingredientId),
          )
          .where(inArray(productIngredients.productId, ids))
          .orderBy(asc(productIngredients.sortOrder))
      : [],
  ]);
  return rows.map(({ updatedAt, ...row }) => ({
    ...row,
    optionGroupIds: links.get(row.id) ?? [],
    excludedOptionGroupIds: excluded
      .filter((e) => e.productId === row.id)
      .map((e) => e.groupId),
    ingredients: recipe
      .filter((r) => r.productId === row.id)
      .map((r) => ({
        ingredientId: r.ingredientId,
        name: r.name,
        adjustable: r.adjustable,
      })),
    updatedAt: updatedAt.toISOString(),
  }));
}

/** Troca receita e grupos desligados do produto (a ordem do array é a da receita). */
async function replaceProductExtras(
  tx: Transaction,
  productId: string,
  extras: {
    ingredients?: IngredientsInput;
    excludedOptionGroupIds?: string[];
  },
) {
  if (extras.ingredients) {
    await tx
      .delete(productIngredients)
      .where(eq(productIngredients.productId, productId));
    if (extras.ingredients.length) {
      await tx.insert(productIngredients).values(
        extras.ingredients.map((i, sortOrder) => ({
          productId,
          ingredientId: i.ingredientId,
          adjustable: i.adjustable,
          sortOrder,
        })),
      );
    }
  }
  if (extras.excludedOptionGroupIds) {
    await tx
      .delete(productExcludedOptionGroups)
      .where(eq(productExcludedOptionGroups.productId, productId));
    if (extras.excludedOptionGroupIds.length) {
      await tx.insert(productExcludedOptionGroups).values(
        extras.excludedOptionGroupIds.map((groupId) => ({
          productId,
          groupId,
        })),
      );
    }
  }
}

async function withCategoryLinks(
  db: Executor,
  rows: CategoryRow[],
): Promise<Category[]> {
  const links = await linksFor(
    db,
    categoryOptionGroups,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    ...row,
    optionGroupIds: links.get(row.id) ?? [],
  }));
}

/** Troca a lista de grupos ligados; a posição no array vira a ordem de exibição. */
async function replaceProductLinks(
  tx: Transaction,
  productId: string,
  groupIds: string[],
) {
  await tx
    .delete(productOptionGroups)
    .where(eq(productOptionGroups.productId, productId));
  if (groupIds.length) {
    await tx
      .insert(productOptionGroups)
      .values(
        groupIds.map((groupId, i) => ({ productId, groupId, sortOrder: i })),
      );
  }
}

async function replaceCategoryLinks(
  tx: Transaction,
  categoryId: string,
  groupIds: string[],
) {
  await tx
    .delete(categoryOptionGroups)
    .where(eq(categoryOptionGroups.categoryId, categoryId));
  if (groupIds.length) {
    await tx
      .insert(categoryOptionGroups)
      .values(
        groupIds.map((groupId, i) => ({ categoryId, groupId, sortOrder: i })),
      );
  }
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  listSectors(): Promise<ProductionSector[]> {
    return this.db
      .select({ id: productionSectors.id, name: productionSectors.name })
      .from(productionSectors)
      .orderBy(asc(productionSectors.name));
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.db
      .select(categoryColumns)
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return withCategoryLinks(this.db, rows);
  }

  createCategory({
    optionGroupIds,
    ...input
  }: z.output<typeof createCategorySchema>): Promise<Category> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values(input)
        .returning(categoryColumns);
      await replaceCategoryLinks(tx, row.id, optionGroupIds);
      return { ...row, optionGroupIds };
    });
  }

  /** Arquivar exige categoria sem produtos ativos, para nada sumir do cardápio sem querer. */
  updateCategory(
    id: string,
    { optionGroupIds, ...input }: z.output<typeof updateCategorySchema>,
  ): Promise<Category> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select(categoryColumns)
        .from(categories)
        .where(eq(categories.id, id))
        .for('update');
      if (!current) throw AppException.notFound('Categoria', id);
      if (input.active === false && current.active) {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(products)
          .where(and(eq(products.categoryId, id), eq(products.active, true)));
        if (n > 0) {
          throw new AppException(
            HttpStatus.CONFLICT,
            errorCodes.categoryInUse,
            `A categoria ${current.name} tem ${n} ${n === 1 ? 'produto ativo' : 'produtos ativos'}. Arquive ou mova os produtos antes.`,
            { activeProducts: n },
          );
        }
      }
      if (optionGroupIds) await replaceCategoryLinks(tx, id, optionGroupIds);
      const [row] = Object.keys(input).length
        ? await tx
            .update(categories)
            .set(input)
            .where(eq(categories.id, id))
            .returning(categoryColumns)
        : [current];
      const [category] = await withCategoryLinks(tx, [row]);
      return category;
    });
  }

  async listProducts(
    query: z.output<typeof listProductsQuerySchema>,
  ): Promise<Product[]> {
    const filters: SQL[] = [];
    if (query.categoryId)
      filters.push(eq(products.categoryId, query.categoryId));
    if (query.available !== undefined)
      filters.push(eq(products.available, query.available));
    if (query.status !== 'all')
      filters.push(eq(products.active, query.status === 'active'));
    const rows = await this.db
      .select(productColumns)
      .from(products)
      .where(and(...filters))
      .orderBy(asc(products.name));
    return withProductLinks(this.db, rows);
  }

  createProduct({
    optionGroupIds,
    excludedOptionGroupIds,
    ingredients: recipe,
    ...input
  }: z.output<typeof createProductSchema>): Promise<Product> {
    return this.db.transaction(async (tx) => {
      await assertCategoryOpen(tx, input.categoryId);
      const [row] = await tx
        .insert(products)
        .values(input)
        .returning(productColumns);
      await replaceProductLinks(tx, row.id, optionGroupIds);
      await replaceProductExtras(tx, row.id, {
        ingredients: recipe,
        excludedOptionGroupIds,
      });
      const [product] = await withProductLinks(tx, [row]);
      return product;
    });
  }

  /** Edição parcial com concorrência otimista; a lista de grupos troca junto. */
  updateProduct(
    id: string,
    {
      version,
      optionGroupIds,
      excludedOptionGroupIds,
      ingredients: recipe,
      ...fields
    }: z.output<typeof updateProductSchema>,
  ): Promise<Product> {
    return this.db.transaction(async (tx) => {
      if (fields.categoryId) await assertCategoryOpen(tx, fields.categoryId);
      const row = await applyVersioned(tx, id, version, fields);
      if (optionGroupIds) await replaceProductLinks(tx, id, optionGroupIds);
      await replaceProductExtras(tx, id, {
        ingredients: recipe,
        excludedOptionGroupIds,
      });
      const [product] = await withProductLinks(tx, [row]);
      return product;
    });
  }

  async setAvailability(
    id: string,
    input: z.output<typeof updateProductAvailabilitySchema>,
  ): Promise<Product> {
    const row = await applyVersioned(this.db, id, input.version, {
      available: input.available,
    });
    const [product] = await withProductLinks(this.db, [row]);
    return product;
  }
}

/** Só altera se a versão enviada for a atual; senão 404 ou 409 com a versão atual. */
async function applyVersioned(
  db: Executor,
  id: string,
  version: number,
  fields: Partial<typeof products.$inferInsert>,
): Promise<ProductRow> {
  const [row] = await db
    .update(products)
    .set({ ...fields, version: sql`${products.version} + 1` })
    .where(and(eq(products.id, id), eq(products.version, version)))
    .returning(productColumns);
  if (row) return row;

  const [current] = await db
    .select({ version: products.version })
    .from(products)
    .where(eq(products.id, id));
  if (!current) throw AppException.notFound('Produto', id);
  throw AppException.versionConflict('Produto', current.version);
}

async function assertCategoryOpen(db: Executor, categoryId: string) {
  const [category] = await db
    .select({ name: categories.name, active: categories.active })
    .from(categories)
    .where(eq(categories.id, categoryId));
  // Categoria inexistente cai na FK (422) no insert/update.
  if (category && !category.active) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      errorCodes.categoryArchived,
      `A categoria ${category.name} está arquivada.`,
      { categoryId },
    );
  }
}
