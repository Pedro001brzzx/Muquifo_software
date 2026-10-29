import { Module } from '@nestjs/common';
import { CashModule } from './cash/cash.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { MenuModule } from './menu/menu.module.js';
import { NetworkModule } from './network/network.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OptionsModule } from './options/options.module.js';
import { OrderingModule } from './ordering/ordering.module.js';
import { PizzaModule } from './pizza/pizza.module.js';
import { RestaurantModule } from './restaurant/restaurant.module.js';
import { TablesModule } from './tables/tables.module.js';

@Module({
  imports: [
    DatabaseModule,
    OperationsModule,
    CatalogModule,
    OptionsModule,
    IngredientsModule,
    PizzaModule,
    RestaurantModule,
    NetworkModule,
    MenuModule,
    CashModule,
    DashboardModule,
    TablesModule,
    OrderingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
