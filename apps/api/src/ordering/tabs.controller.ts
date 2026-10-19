import {
  IDEMPOTENCY_HEADER,
  listTabsQuerySchema,
  openTabSchema,
} from '@muquifo/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IdempotencyService } from '../operations/idempotency.service.js';
import { sendIdempotent } from '../operations/idempotent-reply.js';
import { TabsService } from './tabs.service.js';

@Controller('tabs')
export class TabsController {
  constructor(
    private readonly tabs: TabsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listTabsQuerySchema))
    query: z.output<typeof listTabsQuerySchema>,
  ) {
    return this.tabs.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tabs.get(id);
  }

  @Post()
  async open(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodValidationPipe(openTabSchema))
    body: z.output<typeof openTabSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /tabs',
        payload: body,
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.tabs.open(tx, body),
    );
    return sendIdempotent(reply, result);
  }
}
