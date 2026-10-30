import {
  addPaymentSchema,
  type CurrentUser,
  cancelPaymentSchema,
  cancelTabSchema,
  closeTabSchema,
  IDEMPOTENCY_HEADER,
  tabDetailSchema,
} from '@muquifo/contracts';
import {
  Body,
  Controller,
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
import {
  Approver,
  AuthUser,
  MinRole,
  RequiresApproval,
} from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiIdempotent,
  ApiUuidParam,
  ApiZodBody,
} from '../openapi/api-docs.js';
import { IdempotencyService } from '../operations/idempotency.service.js';
import { sendIdempotent } from '../operations/idempotent-reply.js';
import { BillingService } from './billing.service.js';

const tab = (status: number, description: string) => ({
  status,
  name: 'TabDetail',
  schema: tabDetailSchema,
  description,
});
const notFound = '`NOT_FOUND` — comanda não existe.';
const notOpen = '`TAB_NOT_OPEN` — comanda já fechada ou cancelada.';

@ApiTags('Fechamento de conta')
@Controller('tabs/:id')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  @Post('payments')
  @MinRole('cashier')
  @ApiOperation({
    summary: 'Registra pagamento',
    description:
      'Abate `amountCents` do saldo; nunca passa dele. Em dinheiro, `receivedCents` é o valor entregue e define o troco. Para dividir a conta, registre um pagamento por pessoa.',
  })
  @ApiUuidParam('id', 'Comanda')
  @ApiZodBody(addPaymentSchema)
  @ApiIdempotent(tab(201, 'Comanda com o pagamento registrado.'), {
    404: notFound,
    409: [
      notOpen,
      '`PAYMENT_EXCEEDS_BALANCE` — valor maior que o saldo; `details.balanceCents` traz o saldo.',
      '`CASH_CLOSED` — não há caixa aberto.',
    ],
  })
  async addPayment(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addPaymentSchema))
    body: z.output<typeof addPaymentSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /tabs/:id/payments',
        payload: { id, body },
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.billing.addPayment(tx, id, body),
    );
    return sendIdempotent(reply, result);
  }

  @Post('payments/:paymentId/cancellations')
  @MinRole('cashier')
  @RequiresApproval('estornar um pagamento')
  @ApiOperation({
    summary: 'Estorna pagamento',
    description:
      'Para pagamento lançado errado. Fica registrado com motivo e horário; o valor volta ao saldo.',
  })
  @ApiUuidParam('id', 'Comanda')
  @ApiUuidParam('paymentId', 'Pagamento')
  @ApiZodBody(cancelPaymentSchema)
  @ApiIdempotent(tab(201, 'Comanda com o pagamento estornado.'), {
    404: notFound,
    409: notOpen,
    422: 'Pagamento inexistente, de outra comanda ou já estornado.',
  })
  async cancelPayment(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body(new ZodValidationPipe(cancelPaymentSchema))
    body: z.output<typeof cancelPaymentSchema>,
    @AuthUser() user: CurrentUser,
    @Approver() approver: CurrentUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /tabs/:id/payments/:paymentId/cancellations',
        payload: { id, paymentId, body },
        statusCode: HttpStatus.CREATED,
      },
      async (tx) => {
        const result = await this.billing.cancelPayment(
          tx,
          id,
          paymentId,
          body,
        );
        await this.audit.record(
          {
            action: 'payment_refunded',
            actorId: user.id,
            approverId: approver.id,
            target: paymentId,
            details: { tabId: id, reason: body.reason },
          },
          tx,
        );
        return result;
      },
    );
    return sendIdempotent(reply, result);
  }

  @Post('close')
  @MinRole('cashier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fecha a conta',
    description:
      'RN04: exige saldo zero, nenhum rascunho com itens e a `version` atual da comanda. A mesa volta a ficar livre.',
  })
  @ApiUuidParam('id', 'Comanda')
  @ApiZodBody(closeTabSchema)
  @ApiIdempotent(tab(200, 'Conta fechada.'), {
    404: notFound,
    409: [
      notOpen,
      '`VERSION_CONFLICT` — a comanda mudou; recarregue e confira.',
      '`DRAFT_ORDERS_PENDING` — há rascunho com itens; envie ou cancele.',
      '`BALANCE_NOT_ZERO` — falta pagar, ou pagamentos passam do total; `details.balanceCents`.',
    ],
    422: '`TAB_EMPTY` — comanda sem consumo; use o cancelamento (liberar mesa).',
  })
  async close(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeTabSchema))
    body: z.output<typeof closeTabSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /tabs/:id/close',
        payload: { id, body },
        statusCode: HttpStatus.OK,
      },
      (tx) => this.billing.close(tx, id, body),
    );
    return sendIdempotent(reply, result);
  }

  @Post('cancellations')
  @ApiOperation({
    summary: 'Libera a mesa (cancela comanda sem consumo)',
    description:
      'Para mesa aberta por engano ou cliente que foi embora sem consumir. Só sem itens enviados nem pagamentos; rascunhos são cancelados junto. Motivo obrigatório (RN05).',
  })
  @ApiUuidParam('id', 'Comanda')
  @ApiZodBody(cancelTabSchema)
  @ApiIdempotent(tab(201, 'Comanda cancelada; a mesa fica livre.'), {
    404: notFound,
    409: [
      notOpen,
      '`TAB_HAS_CONSUMPTION` — há itens enviados ou pagamentos; feche a conta.',
    ],
  })
  async cancelTab(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelTabSchema))
    body: z.output<typeof cancelTabSchema>,
    @AuthUser() user: CurrentUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /tabs/:id/cancellations',
        payload: { id, body },
        statusCode: HttpStatus.CREATED,
      },
      async (tx) => {
        const result = await this.billing.cancelTab(tx, id, body);
        await this.audit.record(
          {
            action: 'tab_released',
            actorId: user.id,
            target: id,
            details: { reason: body.reason },
          },
          tx,
        );
        return result;
      },
    );
    return sendIdempotent(reply, result);
  }
}
