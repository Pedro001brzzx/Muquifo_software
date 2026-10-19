import {
  errorCodes,
  type listTabsQuerySchema,
  type openTabSchema,
  type TabDetail,
  type TabSummary,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database, Transaction } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { diningTables, tabs } from '../db/schema.js';
import { getTab, listTabs } from './ordering.queries.js';

@Injectable()
export class TabsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(query: z.output<typeof listTabsQuerySchema>): Promise<TabSummary[]> {
    return listTabs(this.db, query);
  }

  get(id: string): Promise<TabDetail> {
    return getTab(this.db, id);
  }

  /**
   * Abre uma comanda. Uma mesa pode ter várias comandas abertas ao mesmo tempo
   * (contas separadas na mesma mesa); a regra de limitar a uma será configurável.
   */
  async open(
    tx: Transaction,
    input: z.output<typeof openTabSchema>,
  ): Promise<TabDetail> {
    if (input.tableId) {
      const [table] = await tx
        .select({ active: diningTables.active })
        .from(diningTables)
        .where(eq(diningTables.id, input.tableId));
      if (!table || !table.active) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          errorCodes.validation,
          'Mesa inexistente ou desativada.',
          { tableId: input.tableId },
        );
      }
    }
    const [tab] = await tx
      .insert(tabs)
      .values({ tableId: input.tableId, customerName: input.customerName })
      .returning({ id: tabs.id });
    return getTab(tx, tab.id);
  }
}
