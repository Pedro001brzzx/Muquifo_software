import { restaurantSchema, updateRestaurantSchema } from '@muquifo/contracts';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../openapi/api-docs.js';
import { RestaurantService } from './restaurant.service.js';

@ApiTags('Restaurante')
@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly restaurant: RestaurantService) {}

  @Get()
  @ApiOperation({
    summary: 'Nome, frase e aviso do restaurante',
    description: 'Registro único. `name` vazio = ainda não preenchido.',
  })
  @ApiZodResponse({
    status: 200,
    name: 'Restaurant',
    schema: restaurantSchema,
  })
  get() {
    return this.restaurant.get();
  }

  @Patch()
  @ApiOperation({
    summary: 'Altera nome, frase e aviso',
    description:
      'Envie a `version` lida; texto vazio em `tagline`/`notice` apaga.',
  })
  @ApiZodBody(updateRestaurantSchema)
  @ApiZodResponse({
    status: 200,
    name: 'Restaurant',
    schema: restaurantSchema,
  })
  @ApiErrors({
    409: '`VERSION_CONFLICT` — alterado por outra pessoa.',
    422: '`VALIDATION_FAILED` — dados inválidos.',
  })
  update(
    @Body(new ZodValidationPipe(updateRestaurantSchema))
    body: z.output<typeof updateRestaurantSchema>,
  ) {
    return this.restaurant.update(body);
  }
}
