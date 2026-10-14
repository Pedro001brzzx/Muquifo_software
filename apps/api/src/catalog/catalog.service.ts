import type {
  Category,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  Product,
  ProductionSector,
  updateProductAvailabilitySchema,
} from '@muquifo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { categories, productionSectors, products } from '../db/schema.js';

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
  name: products.name,
  description: products.description,
  priceCents: products.priceCents,
  available: products.available,
  allowFractional: products.allowFractional,
  version: products.version,
};

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  listSectors(): Promise<ProductionSector[]> {
    return this.db
      .select({ id: productionSectors.id, name: productionSectors.name })
      .from(productionSectors)
      .orderBy(asc(productionSectors.name));
  }

  listCategories(): Promise<Category[]> {
    return this.db
      .select(categoryColumns)
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  }

  async createCategory(
    input: z.output<typeof createCategorySchema>,
  ): Promise<Category> {
    const [row] = await this.db
      .insert(categories)
      .values(input)
      .returning(categoryColumns);
    return row;
  }

  listProducts(
    query: z.output<typeof listProductsQuerySchema>,
  ): Promise<Product[]> {
    const filters: SQL[] = [];
    if (query.categoryId)
      filters.push(eq(products.categoryId, query.categoryId));
    if (query.available !== undefined)
      filters.push(eq(products.available, query.available));
    return this.db
      .select(productColumns)
      .from(products)
      .where(and(...filters))
      .orderBy(asc(products.name));
  }

  async createProduct(
    input: z.output<typeof createProductSchema>,
  ): Promise<Product> {
    const [row] = await this.db
      .insert(products)
      .values(input)
      .returning(productColumns);
    return row;
  }

  /** Concorrência otimista: só altera se a versão enviada for a atual. */
  async setAvailability(
    id: string,
    input: z.output<typeof updateProductAvailabilitySchema>,
  ): Promise<Product> {
    const [row] = await this.db
      .update(products)
      .set({
        available: input.available,
        version: sql`${products.version} + 1`,
      })
      .where(and(eq(products.id, id), eq(products.version, input.version)))
      .returning(productColumns);
    if (row) return row;

    const [current] = await this.db
      .select({ version: products.version })
      .from(products)
      .where(eq(products.id, id));
    if (!current) throw AppException.notFound('Produto', id);
    throw AppException.versionConflict('Produto', current.version);
  }
}
