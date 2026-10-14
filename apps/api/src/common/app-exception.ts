import { errorCodes } from '@muquifo/contracts';
import { HttpStatus } from '@nestjs/common';

/** Erro de domínio que o filtro global converte no formato { code, message, details, requestId }. */
export class AppException extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(resource: string, id: string) {
    return new AppException(
      HttpStatus.NOT_FOUND,
      errorCodes.notFound,
      `${resource} não encontrado.`,
      { id },
    );
  }

  static versionConflict(resource: string, currentVersion?: number) {
    return new AppException(
      HttpStatus.CONFLICT,
      errorCodes.versionConflict,
      `${resource} foi alterado por outra operação. Recarregue e revise.`,
      currentVersion === undefined ? undefined : { currentVersion },
    );
  }
}
