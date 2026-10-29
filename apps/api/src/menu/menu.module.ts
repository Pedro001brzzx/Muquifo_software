import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { OptionsModule } from '../options/options.module.js';
import { PizzaModule } from '../pizza/pizza.module.js';
import { RestaurantModule } from '../restaurant/restaurant.module.js';
import { MenuController } from './menu.controller.js';
import { MenuService } from './menu.service.js';

@Module({
  imports: [CatalogModule, OptionsModule, PizzaModule, RestaurantModule],
  controllers: [MenuController],
  providers: [MenuService],
})
export class MenuModule {}
