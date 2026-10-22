import { type ApiError, errorCodes } from '@muquifo/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from './app-exception.js';

const codeByStatus: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: errorCodes.validation,
  [HttpStatus.UNAUTHORIZED]: errorCodes.unauthorized,
  [HttpStatus.FORBIDDEN]: errorCodes.forbidden,
  [HttpStatus.NOT_FOUND]: errorCodes.notFound,
  [HttpStatus.CONFLICT]: errorCodes.conflict,
  [HttpStatus.UNPROCESSABLE_ENTITY]: errorCodes.validation,
};

/** Códigos do PostgreSQL tratados como erro do cliente, não do servidor. */
const pgErrors: Record<
  string,
  { status: HttpStatus; code: string; message: string }
> = {
  '23505': {
    status: HttpStatus.CONFLICT,
    code: errorCodes.conflict,
    message: 'Já existe um registro com esses dados.',
  },
  '23503': {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: errorCodes.validation,
    message: 'Referência inexistente ou em uso.',
  },
  '23514': {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: errorCodes.validation,
    message: 'Valor fora das regras permitidas.',
  },
};

/** Mensagem e campo por restrição única, para o formulário apontar o campo certo. */
const uniqueConstraints: Record<string, { message: string; field: string }> = {
  products_category_name_uq: {
    message: 'Já existe um produto com esse nome nesta categoria.',
    field: 'name',
  },
  products_code_uq: {
    message: 'Esse código já é usado por outro produto.',
    field: 'code',
  },
  categories_name_uq: {
    message: 'Já existe uma categoria com esse nome.',
    field: 'name',
  },
  option_groups_name_uq: {
    message: 'Já existe um grupo de complementos com esse nome.',
    field: 'name',
  },
  ingredients_name_uq: {
    message: 'Já existe um ingrediente com esse nome.',
    field: 'name',
  },
  pizza_tiers_name_uq: {
    message: 'Já existe uma faixa com esse nome.',
    field: 'name',
  },
  pizza_flavors_name_uq: {
    message: 'Já existe um sabor com esse nome.',
    field: 'name',
  },
  dining_tables_number_uq: {
    message: 'Já existe uma mesa com esse número.',
    field: 'number',
  },
};

function findPgError(
  error: unknown,
): { code: string; constraint?: string } | undefined {
  // Drizzle embrulha o erro do driver em `cause`.
  for (
    let e: unknown = error;
    e && typeof e === 'object';
    e = (e as { cause?: unknown }).cause
  ) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (typeof code === 'string' && /^\d{5}$/.test(code)) {
      return {
        code,
        constraint: typeof constraint === 'string' ? constraint : undefined,
      };
    }
  }
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Omit<ApiError, 'requestId'> = {
      code: errorCodes.internal,
      message: 'Erro interno. Informe o requestId ao suporte.',
    };

    const pg = findPgError(exception);
    if (exception instanceof AppException) {
      status = exception.status;
      body = {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: codeByStatus[status] ?? errorCodes.internal,
        message:
          status === HttpStatus.NOT_FOUND
            ? 'Recurso não encontrado.'
            : exception.message,
      };
    } else if (pg && pgErrors[pg.code]) {
      const mapped = pgErrors[pg.code];
      const unique = pg.constraint
        ? uniqueConstraints[pg.constraint]
        : undefined;
      status = mapped.status;
      body = unique
        ? {
            code: mapped.code,
            message: unique.message,
            details: { field: unique.field },
          }
        : { code: mapped.code, message: mapped.message };
    }

    if (status >= 500) {
      // Detalhes internos ficam só no log local, nunca na resposta.
      this.logger.error(
        `[${request.id}] ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    void reply
      .status(status)
      .send({ ...body, requestId: request.id } satisfies ApiError);
  }
}
