import type { Restaurant, updateRestaurantSchema } from '@muquifo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../common/app-exception.js';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { restaurant } from '../db/schema.js';

const columns = {
  name: restaurant.name,
  tagline: restaurant.tagline,
  notice: restaurant.notice,
  version: restaurant.version,
};

@Injectable()
export class RestaurantService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Cria a linha única na primeira leitura (banco novo ou recém-esvaziado). */
  async get(): Promise<Restaurant> {
    await this.db.insert(restaurant).values({ id: 1 }).onConflictDoNothing();
    const [row] = await this.db
      .select(columns)
      .from(restaurant)
      .where(eq(restaurant.id, 1));
    return row;
  }

  async update(
    input: z.output<typeof updateRestaurantSchema>,
  ): Promise<Restaurant> {
    const current = await this.get();
    const [row] = await this.db
      .update(restaurant)
      .set({
        name: input.name,
        tagline: input.tagline,
        notice: input.notice,
        version: current.version + 1,
      })
      .where(and(eq(restaurant.id, 1), eq(restaurant.version, input.version)))
      .returning(columns);
    if (!row) {
      throw AppException.versionConflict('Restaurante', current.version);
    }
    return row;
  }
}
