import { Module } from '@nestjs/common';
import { PizzaController } from './pizza.controller.js';
import { PizzaService } from './pizza.service.js';

@Module({
  controllers: [PizzaController],
  providers: [PizzaService],
  exports: [PizzaService],
})
export class PizzaModule {}
