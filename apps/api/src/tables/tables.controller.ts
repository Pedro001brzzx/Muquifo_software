import { createDiningTableSchema } from '@muquifo/contracts';
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TablesService } from './tables.service.js';

@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  list() {
    return this.tables.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createDiningTableSchema))
    body: z.output<typeof createDiningTableSchema>,
  ) {
    return this.tables.create(body);
  }
}
