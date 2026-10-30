import {
  createIngredientSchema,
  ingredientSchema,
  listIngredientsQuerySchema,
  updateIngredientSchema,
} from '@muquifo/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { MinRole } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiErrors,
  ApiUuidParam,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { IngredientsService } from './ingredients.service.js';

const doc = (status: number, description?: string) => ({
  status,
  name: 'Ingredient',
  schema: ingredientSchema,
  description,
});
const duplicate =
  '`CONFLICT` — já existe ingrediente com esse nome (sem diferenciar maiúsculas).';

@ApiTags('Ingredientes')
@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista a biblioteca de ingredientes',
    description:
      'Em ordem alfabética, com quantos produtos ativos usam cada um.',
  })
  @ApiZodQuery(listIngredientsQuerySchema)
  @ApiZodResponse({ ...doc(200), isArray: true })
  list(
    @Query(new ZodValidationPipe(listIngredientsQuerySchema))
    query: z.output<typeof listIngredientsQuerySchema>,
  ) {
    return this.ingredients.list(query);
  }

  @MinRole('owner')
  @Post()
  @ApiOperation({ summary: 'Cria ingrediente' })
  @ApiZodBody(createIngredientSchema)
  @ApiZodResponse(doc(201, 'Ingrediente criado.'))
  @ApiErrors({ 409: duplicate, 422: '`VALIDATION_FAILED` — nome inválido.' })
  create(
    @Body(new ZodValidationPipe(createIngredientSchema))
    body: z.output<typeof createIngredientSchema>,
  ) {
    return this.ingredients.create(body);
  }

  @MinRole('owner')
  @Patch(':id')
  @ApiOperation({
    summary: 'Renomeia ou arquiva ingrediente',
    description:
      'Arquivado sai da biblioteca; produtos que já usam continuam com ele.',
  })
  @ApiUuidParam('id', 'Ingrediente')
  @ApiZodBody(updateIngredientSchema)
  @ApiZodResponse(doc(200, 'Ingrediente atualizado.'))
  @ApiErrors({
    404: '`NOT_FOUND` — ingrediente não existe.',
    409: duplicate,
    422: '`VALIDATION_FAILED` — dados inválidos.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateIngredientSchema))
    body: z.output<typeof updateIngredientSchema>,
  ) {
    return this.ingredients.update(id, body);
  }
}
