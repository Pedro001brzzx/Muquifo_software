import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import { createDatabase, createPool } from './client.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => createPool(loadEnv().DATABASE_URL),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: createDatabase,
    },
    PoolCloser,
  ],
  exports: [DB, PG_POOL],
})
export class DatabaseModule {}
