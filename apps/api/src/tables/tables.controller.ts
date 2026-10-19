import { createDiningTableSchema, diningTableSchema } from '@muquifo/contracts';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../openapi/api-docs.js';
import { TablesService } from './tables.service.js';

@ApiTags('Mesas')
@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista mesas',
    description:
      '`status` vem das comandas abertas: `closing` tem prioridade sobre `occupied`.',
  })
  @ApiZodResponse({
    status: 200,
    name: 'DiningTable',
    schema: diningTableSchema,
    isArray: true,
  })
  list() {
    return this.tables.list();
  }

  @Post()
  @ApiOperation({ summary: 'Cadastra mesa' })
  @ApiZodBody(createDiningTableSchema)
  @ApiZodResponse({
    status: 201,
    name: 'DiningTable',
    schema: diningTableSchema,
    description: 'Mesa criada.',
  })
  @ApiErrors({
    409: '`CONFLICT` — já existe mesa com esse número.',
    422: '`VALIDATION_FAILED` — dados inválidos.',
  })
  create(
    @Body(new ZodValidationPipe(createDiningTableSchema))
    body: z.output<typeof createDiningTableSchema>,
  ) {
    return this.tables.create(body);
  }
}
