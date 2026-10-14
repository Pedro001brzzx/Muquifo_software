import { errorCodes } from '@muquifo/contracts';
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from './app-exception.js';

/** Valida e transforma body/query/params com um schema Zod de @muquifo/contracts. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCodes.validation,
        'Dados inválidos.',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
