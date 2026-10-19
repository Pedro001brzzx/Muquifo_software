import {
  IDEMPOTENCY_HEADER,
  listTabsQuerySchema,
  openTabSchema,
  tabDetailSchema,
  tabSummarySchema,
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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiErrors,
  ApiIdempotent,
  ApiUuidParam,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { IdempotencyService } from '../operations/idempotency.service.js';
import { sendIdempotent } from '../operations/idempotent-reply.js';
import { TabsService } from './tabs.service.js';

@ApiTags('Comandas')
@Controller('tabs')
export class TabsController {
  constructor(
    private readonly tabs: TabsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista comandas',
    description:
      'Mais recentes primeiro. `totalCents` soma só itens ativos de pedidos enviados.',
  })
  @ApiZodQuery(listTabsQuerySchema)
  @ApiZodResponse({
    status: 200,
    name: 'TabSummary',
    schema: tabSummarySchema,
    isArray: true,
  })
  @ApiErrors({ 422: '`VALIDATION_FAILED` — filtro inválido.' })
  list(
    @Query(new ZodValidationPipe(listTabsQuerySchema))
    query: z.output<typeof listTabsQuerySchema>,
  ) {
    return this.tabs.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe da comanda',
    description:
      'Pedidos com itens (inclusive cancelados), total da conta, rascunhos em `draftCents` e saldo.',
  })
  @ApiUuidParam('id', 'Comanda')
  @ApiZodResponse({ status: 200, name: 'TabDetail', schema: tabDetailSchema })
  @ApiErrors({ 404: '`NOT_FOUND` — comanda não existe.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tabs.get(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Abre comanda',
    description:
      'Com `tableId` vincula a uma mesa (que passa a aparecer ocupada); sem mesa serve para balcão, retirada e entrega.',
  })
  @ApiZodBody(openTabSchema)
  @ApiIdempotent(
    {
      status: 201,
      name: 'TabDetail',
      schema: tabDetailSchema,
      description: 'Comanda aberta.',
    },
    { 422: '`VALIDATION_FAILED` — mesa inexistente ou desativada.' },
  )
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
