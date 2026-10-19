import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';
import { OperationsController } from './operations.controller.js';

@Global()
@Module({
  controllers: [OperationsController],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class OperationsModule {}
