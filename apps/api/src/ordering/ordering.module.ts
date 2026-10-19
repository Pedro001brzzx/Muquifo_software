import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { TabsController } from './tabs.controller.js';
import { TabsService } from './tabs.service.js';

@Module({
  controllers: [TabsController, OrdersController, BillingController],
  providers: [TabsService, OrdersService, BillingService],
})
export class OrderingModule {}
