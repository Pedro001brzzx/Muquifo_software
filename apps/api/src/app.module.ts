import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OptionsModule } from './options/options.module.js';
import { OrderingModule } from './ordering/ordering.module.js';
import { PizzaModule } from './pizza/pizza.module.js';
import { TablesModule } from './tables/tables.module.js';

@Module({
  imports: [
    DatabaseModule,
    OperationsModule,
    CatalogModule,
    OptionsModule,
    IngredientsModule,
    PizzaModule,
    TablesModule,
    OrderingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
