import { createProductSchema, errorCodes } from '@muquifo/contracts';
import { AppException } from './app-exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(createProductSchema);
  const categoryId = '0b9a3c1e-8c1f-4c47-9d6a-2f5d0f8b6a11';

  it('aplica defaults e retorna dados válidos', () => {
    expect(
      pipe.transform({ categoryId, name: ' Pizza ', priceCents: 6000 }),
    ).toEqual({
      categoryId,
      sectorId: null,
      name: 'Pizza',
      description: null,
      priceCents: 6000,
      allowFractional: false,
    });
  });

  it('rejeita preço fracionado em centavos com 422', () => {
    try {
      pipe.transform({ categoryId, name: 'Pizza', priceCents: 60.5 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const e = error as AppException;
      expect(e.status).toBe(422);
      expect(e.code).toBe(errorCodes.validation);
      expect(e.details).toEqual([
        expect.objectContaining({ path: 'priceCents' }),
      ]);
    }
  });
});
