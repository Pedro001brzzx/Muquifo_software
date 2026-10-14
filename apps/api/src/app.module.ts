import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { TablesModule } from './tables/tables.module.js';

@Module({
  imports: [DatabaseModule, CatalogModule, TablesModule],
  controllers: [HealthController],
})
export class AppModule {}
