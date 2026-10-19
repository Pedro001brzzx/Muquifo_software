import type { createDiningTableSchema, DiningTable } from '@muquifo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { diningTables, tabs } from '../db/schema.js';

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

  /** Status derivado das comandas: em fechamento tem prioridade sobre ocupada. */
  async list(): Promise<DiningTable[]> {
    const rows = await this.db
      .select({
        ...tableColumns,
        closing: sql<boolean>`bool_or(${tabs.status} = 'closing')`,
        occupied: sql<boolean>`bool_or(${tabs.status} = 'open')`,
      })
      .from(diningTables)
      .leftJoin(
        tabs,
        and(
          eq(tabs.tableId, diningTables.id),
          inArray(tabs.status, ['open', 'closing']),
        ),
      )
      .groupBy(diningTables.id)
      .orderBy(asc(diningTables.number));
    return rows.map(({ closing, occupied, ...row }) => ({
      ...row,
      status: closing ? 'closing' : occupied ? 'occupied' : 'free',
    }));
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
