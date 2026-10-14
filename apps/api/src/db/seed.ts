import { loadEnv } from '../config/env.js';
import { createDatabase, createPool } from './client.js';
import {
  categories,
  diningTables,
  productionSectors,
  products,
} from './schema.js';

/** Dados de demonstração para testes manuais. Idempotente: pode rodar várias vezes. */
const pool = createPool(loadEnv().DATABASE_URL);
const db = createDatabase(pool);

try {
  await db.transaction(async (tx) => {
    await tx
      .insert(productionSectors)
      .values([{ name: 'Cozinha' }, { name: 'Bar' }, { name: 'Pizzaria' }])
      .onConflictDoNothing();
    await tx
      .insert(categories)
      .values([
        { name: 'Pizzas', sortOrder: 1 },
        { name: 'Lanches', sortOrder: 2 },
        { name: 'Bebidas', sortOrder: 3 },
        { name: 'Sobremesas', sortOrder: 4 },
      ])
      .onConflictDoNothing();

    const sectorIds = Object.fromEntries(
      (await tx.select().from(productionSectors)).map((s) => [s.name, s.id]),
    );
    const categoryIds = Object.fromEntries(
      (await tx.select().from(categories)).map((c) => [c.name, c.id]),
    );

    await tx
      .insert(products)
      .values(
        [
          {
            name: 'Pizza grande',
            category: 'Pizzas',
            sector: 'Pizzaria',
            price: 6000,
          },
          {
            name: 'Pizza média',
            category: 'Pizzas',
            sector: 'Pizzaria',
            price: 4800,
          },
          {
            name: 'X-búrguer',
            category: 'Lanches',
            sector: 'Cozinha',
            price: 2800,
          },
          {
            name: 'Batata frita',
            category: 'Lanches',
            sector: 'Cozinha',
            price: 2200,
          },
          {
            name: 'Refrigerante lata',
            category: 'Bebidas',
            sector: 'Bar',
            price: 600,
          },
          {
            name: 'Suco natural',
            category: 'Bebidas',
            sector: 'Bar',
            price: 900,
          },
          {
            name: 'Pudim',
            category: 'Sobremesas',
            sector: 'Cozinha',
            price: 1200,
          },
        ].map((p) => ({
          name: p.name,
          categoryId: categoryIds[p.category],
          sectorId: sectorIds[p.sector],
          priceCents: p.price,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(diningTables)
      .values(
        Array.from({ length: 12 }, (_, i) => ({ number: i + 1, seats: 4 })),
      )
      .onConflictDoNothing();
  });
  console.log('Seed aplicado.');
} finally {
  await pool.end();
}
