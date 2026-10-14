import type { createDiningTableSchema, DiningTable } from '@muquifo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { diningTables } from '../db/schema.js';

const tableColumns = {
  id: diningTables.id,
  number: diningTables.number,
  label: diningTables.label,
  seats: diningTables.seats,
  active: diningTables.active,
};

@Injectable()
export class TablesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<DiningTable[]> {
    const rows = await this.db
      .select(tableColumns)
      .from(diningTables)
      .orderBy(asc(diningTables.number));
    // TODO(comandas): derivar status das comandas abertas.
    return rows.map((row) => ({ ...row, status: 'free' as const }));
  }

  async create(
    input: z.output<typeof createDiningTableSchema>,
  ): Promise<DiningTable> {
    const [row] = await this.db
      .insert(diningTables)
      .values(input)
      .returning(tableColumns);
    return { ...row, status: 'free' };
  }
}
