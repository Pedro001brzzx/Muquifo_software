import {
  addCashMovementSchema,
  type CurrentUser,
  cashSessionSchema,
  closeCashSchema,
  currentCashSchema,
  IDEMPOTENCY_HEADER,
  listCashSessionsQuerySchema,
  openCashSchema,
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
import { AuthUser, MinRole } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiIdempotent,
  ApiUuidParam,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { IdempotencyService } from '../operations/idempotency.service.js';
import { sendIdempotent } from '../operations/idempotent-reply.js';
import { CashService } from './cash.service.js';

const session = (status: number, description: string) => ({
  status,
  name: 'CashSession',
  schema: cashSessionSchema,
  description,
});
const closed = '`CASH_CLOSED` — o caixa já foi fechado.';

@ApiTags('Caixa')
@MinRole('cashier')
@Controller('cash')
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('current')
  @ApiOperation({
    summary: 'Caixa aberto agora',
    description: '`session: null` quando o caixa está fechado.',
  })
  @ApiZodResponse({
    status: 200,
    name: 'CurrentCash',
    schema: currentCashSchema,
  })
  async current(@AuthUser() user: CurrentUser) {
    const session = await this.cash.current();
    // Fechamento cego de verdade: com o caixa aberto, só o dono vê o esperado.
    if (session && user.role !== 'owner') {
      return { session: { ...session, received: null, expected: null } };
    }
    return { session };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Histórico de caixas, do mais recente' })
  @ApiZodQuery(listCashSessionsQuerySchema)
  @ApiZodResponse({ ...session(200, 'Caixas.'), isArray: true })
  list(
    @Query(new ZodValidationPipe(listCashSessionsQuerySchema))
    query: z.output<typeof listCashSessionsQuerySchema>,
  ) {
    return this.cash.list(query.limit);
  }

  @Post('sessions')
  @ApiOperation({
    summary: 'Abre o caixa',
    description: 'Com o fundo de troco contado. Só um caixa aberto por vez.',
  })
  @ApiZodBody(openCashSchema)
  @ApiIdempotent(session(201, 'Caixa aberto.'), {
    409: '`CASH_ALREADY_OPEN` — já existe caixa aberto.',
  })
  async open(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodValidationPipe(openCashSchema))
    body: z.output<typeof openCashSchema>,
    @AuthUser() user: CurrentUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /cash/sessions',
        payload: { body, by: user.id },
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.cash.open(tx, body, user.name),
    );
    return sendIdempotent(reply, result);
  }

  @Post('sessions/:id/movements')
  @ApiOperation({
    summary: 'Registra sangria ou suprimento',
    description:
      'Sangria (retirada) e suprimento (reforço) de dinheiro, sempre com motivo.',
  })
  @ApiUuidParam('id', 'Caixa')
  @ApiZodBody(addCashMovementSchema)
  @ApiIdempotent(session(201, 'Caixa com o movimento.'), {
    404: '`NOT_FOUND` — caixa não existe.',
    409: closed,
    422: '`CASH_INSUFFICIENT` — sangria maior que o dinheiro esperado na gaveta.',
  })
  async addMovement(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addCashMovementSchema))
    body: z.output<typeof addCashMovementSchema>,
    @AuthUser() user: CurrentUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /cash/sessions/:id/movements',
        payload: { id, body },
        statusCode: HttpStatus.CREATED,
      },
      (tx) => this.cash.addMovement(tx, id, body, user.name),
    );
    return sendIdempotent(reply, result);
  }

  @Post('sessions/:id/close')
  @ApiOperation({
    summary: 'Fecha o caixa (cego)',
    description:
      'O operador informa o que contou em cada forma, sem ver o esperado. O esperado é congelado e a diferença volta na resposta.',
  })
  @ApiUuidParam('id', 'Caixa')
  @ApiZodBody(closeCashSchema)
  @ApiIdempotent(
    session(200, 'Caixa fechado, com esperado, contado e diferença.'),
    {
      404: '`NOT_FOUND` — caixa não existe.',
      409: [closed, '`VERSION_CONFLICT` — o caixa mudou; recarregue.'],
    },
  )
  async close(
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeCashSchema))
    body: z.output<typeof closeCashSchema>,
    @AuthUser() user: CurrentUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(
      {
        key,
        scope: 'POST /cash/sessions/:id/close',
        payload: { id, body },
        statusCode: HttpStatus.OK,
      },
      (tx) => this.cash.close(tx, id, body, user.name),
    );
    return sendIdempotent(reply, result);
  }
}
