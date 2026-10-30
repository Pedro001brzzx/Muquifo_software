import {
  addOrderItemSchema,
  type CurrentUser,
  cancelOrderSchema,
  createOrderSchema,
  IDEMPOTENCY_HEADER,
  orderSchema,
  submitOrderSchema,
} from '@muquifo/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { AuditService } from '../auth/audit.service.js';
import { Approver, AuthUser, RequiresApproval } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiErrors,
  ApiIdempotent,
  ApiUuidParam,
  ApiZodBody,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { IdempotencyService } from '../operations/idempotency.service.js';
import { sendIdempotent } from '../operations/idempotent-reply.js';
import { OrdersService } from './orders.service.js';

const order = (status: number, description: string) => ({
  status,
  name: 'Order',
  schema: orderSchema,
  description,
});

const tabNotOpen =
  '`TAB_NOT_OPEN` — comanda em fechamento, fechada ou cancelada.';
const notDraft =
  '`ORDER_NOT_EDITABLE` — pedido já enviado ou cancelado; só rascunho aceita alteração.';
const notFound = '`NOT_FOUND` — pedido não existe.';
// Regras de cada item lançado (RF05).
const itemConflicts = [
  '`PRODUCT_UNAVAILABLE` — produto marcado como indisponível.',
  '`PRICE_CHANGED` — `expectedUnitPriceCents` difere do preço atual; `details.currentUnitPriceCents` traz o novo.',
];
const itemInvalid = [
  'Produto inexistente.',
  'Quantidade fracionada em produto que só aceita inteiro.',
];

@ApiTags('Pedidos')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do pedido' })
  @ApiUuidParam('id', 'Pedido')
  @ApiZodResponse(
    order(200, 'Pedido com todos os itens, inclusive cancelados.'),
  )
  @ApiErrors({ 404: notFound })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Cria pedido',
    description: [
      'Cria um rascunho na comanda. Pode vir com `items` e, com `submit: true`,',
      'já é enviado na mesma operação (fluxo da fila offline do APK).',
      'Canal `table` exige comanda vinculada a uma mesa.',
      'Preço, nome e setor de cada item são registrados no servidor no momento da venda.',
    ].join(' '),
  })
  @ApiZodBody(createOrderSchema)
  @ApiIdempotent(order(201, 'Pedido criado.'), {
    404: '`NOT_FOUND` — comanda não existe.',
    409: [tabNotOpen, ...itemConflicts],
    422: [
      ...itemInvalid,
      'Canal `table` em comanda sem mesa.',
      '`EMPTY_ORDER` — `submit: true` sem itens.',
    ],
  })
  async create(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodValidationPipe(createOrderSchema))
    body: z.output<typeof createOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /orders',
        payload: body,
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.orders.create(tx, body),
    );
    return sendIdempotent(reply, result);
  }

  @Post(':id/items')
  @ApiOperation({
    summary: 'Adiciona item ao rascunho',
    description:
      'Envie `expectedUnitPriceCents` com o preço que o aparelho exibiu para não cobrar um valor que o cliente não viu.',
  })
  @ApiUuidParam('id', 'Pedido em rascunho')
  @ApiZodBody(addOrderItemSchema)
  @ApiIdempotent(order(201, 'Pedido atualizado.'), {
    404: notFound,
    409: [tabNotOpen, notDraft, ...itemConflicts],
    422: itemInvalid,
  })
  async addItem(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addOrderItemSchema))
    body: z.output<typeof addOrderItemSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /orders/:id/items',
        payload: { id, body },
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.orders.addItem(tx, id, body),
    );
    return sendIdempotent(reply, result);
  }

  @Delete(':id/items/:itemId')
  @ApiOperation({
    summary: 'Remove item do rascunho',
    description:
      'Só antes do envio. Depois de enviado, use cancelamento (fica registrado com motivo).',
  })
  @ApiUuidParam('id', 'Pedido em rascunho')
  @ApiUuidParam('itemId', 'Item do pedido')
  @ApiIdempotent(order(200, 'Pedido atualizado.'), {
    404: [notFound, '`NOT_FOUND` — item não existe neste pedido.'],
    409: [tabNotOpen, notDraft],
  })
  async removeItem(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'DELETE /orders/:id/items/:itemId',
        payload: { id, itemId },
        statusCode: HttpStatus.OK,
      },
      (tx) => this.orders.removeItem(tx, id, itemId),
    );
    return sendIdempotent(reply, result);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envia o pedido',
    description:
      'Envie a `version` do pedido que foi revisado. Depois do envio os itens passam a contar no total da comanda e não podem mais ser removidos.',
  })
  @ApiUuidParam('id', 'Pedido em rascunho')
  @ApiZodBody(submitOrderSchema)
  @ApiIdempotent(order(200, 'Pedido enviado.'), {
    404: notFound,
    409: [
      tabNotOpen,
      notDraft,
      '`VERSION_CONFLICT` — o pedido mudou depois da revisão; `details.currentVersion` traz a atual.',
    ],
    422: '`EMPTY_ORDER` — pedido sem itens.',
  })
  async submit(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(submitOrderSchema))
    body: z.output<typeof submitOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /orders/:id/submit',
        payload: { id, body },
        statusCode: HttpStatus.OK,
      },
      (tx) => this.orders.submit(tx, id, body),
    );
    return sendIdempotent(reply, result);
  }

  @Post(':id/cancellations')
  // Item já enviado para a cozinha: cancelar sem o gerente é a fraude clássica.
  @RequiresApproval('cancelar item já enviado')
  @ApiOperation({
    summary: 'Cancela pedido ou itens',
    description:
      'Nada é apagado (RN05): itens ficam marcados com motivo e horário. Sem `itemIds` cancela todos os itens ativos; se nenhum item ativo restar, o pedido inteiro fica cancelado. Aceito também com a comanda em fechamento.',
  })
  @ApiUuidParam('id', 'Pedido')
  @ApiZodBody(cancelOrderSchema)
  @ApiIdempotent(order(201, 'Cancelamento registrado.'), {
    404: notFound,
    409: [
      '`TAB_NOT_OPEN` — comanda fechada ou cancelada.',
      '`ORDER_NOT_EDITABLE` — pedido já cancelado.',
    ],
    422: 'Itens inexistentes, de outro pedido ou já cancelados.',
  })
  async cancel(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema))
    body: z.output<typeof cancelOrderSchema>,
    @AuthUser() user: CurrentUser,
    @Approver() approver: CurrentUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /orders/:id/cancellations',
        payload: { id, body },
        statusCode: HttpStatus.CREATED,
      },
      async (tx) => {
        const result = await this.orders.cancel(tx, id, body);
        await this.audit.record(
          {
            action: 'order_canceled',
            actorId: user.id,
            approverId: approver.id,
            target: id,
            details: { reason: body.reason, itemIds: body.itemIds ?? 'todos' },
          },
          tx,
        );
        return result;
      },
    );
    return sendIdempotent(reply, result);
  }
}
