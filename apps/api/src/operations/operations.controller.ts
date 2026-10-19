import { operationSchema } from '@muquifo/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiErrors,
  ApiUuidParam,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { IdempotencyService } from './idempotency.service.js';

@ApiTags('Operações')
@Controller('operations')
export class OperationsController {
  constructor(private readonly idempotency: IdempotencyService) {}

  /** Após timeout, o aparelho consulta aqui antes de concluir que a operação falhou. */
  @Get(':operationId')
  @ApiOperation({
    summary: 'Resultado de uma operação idempotente',
    description:
      'Depois de um timeout, consulte pela `Idempotency-Key` enviada. 404 significa que a operação não foi gravada e pode ser reenviada com a mesma chave.',
  })
  @ApiUuidParam('operationId', 'A Idempotency-Key usada no envio')
  @ApiZodResponse({ status: 200, name: 'Operation', schema: operationSchema })
  @ApiErrors({ 404: '`NOT_FOUND` — nenhuma operação gravada com essa chave.' })
  find(@Param('operationId', ParseUUIDPipe) operationId: string) {
    return this.idempotency.find(operationId);
  }
}
