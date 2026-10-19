import {
  addOrderItemSchema,
  cancelOrderSchema,
  createOrderSchema,
  IDEMPOTENCY_HEADER,
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
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IdempotencyService } from '../operations/idempotency.service.js';
import { sendIdempotent } from '../operations/idempotent-reply.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post()
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
  async cancel(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema))
    body: z.output<typeof cancelOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /orders/:id/cancellations',
        payload: { id, body },
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.orders.cancel(tx, id, body),
    );
    return sendIdempotent(reply, result);
  }
}
