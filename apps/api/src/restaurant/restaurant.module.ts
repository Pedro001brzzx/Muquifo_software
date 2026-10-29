import { Module } from '@nestjs/common';
import { RestaurantController } from './restaurant.controller.js';
import { RestaurantService } from './restaurant.service.js';

@Module({
  controllers: [RestaurantController],
  providers: [RestaurantService],
  exports: [RestaurantService],
})
export class RestaurantModule {}
