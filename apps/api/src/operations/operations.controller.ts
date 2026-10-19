import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly idempotency: IdempotencyService) {}

  /** Após timeout, o aparelho consulta aqui antes de concluir que a operação falhou. */
  @Get(':operationId')
  find(@Param('operationId', ParseUUIDPipe) operationId: string) {
    return this.idempotency.find(operationId);
  }
}
