import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { TabsController } from './tabs.controller.js';
import { TabsService } from './tabs.service.js';

@Module({
  controllers: [TabsController, OrdersController],
  providers: [TabsService, OrdersService],
})
export class OrderingModule {}
