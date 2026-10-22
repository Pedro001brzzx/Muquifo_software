import {
  createPizzaFlavorSchema,
  createPizzaTierSchema,
  listPizzaFlavorsQuerySchema,
  listPizzaTiersQuerySchema,
  pizzaFlavorSchema,
  pizzaTierSchema,
  updatePizzaFlavorSchema,
  updatePizzaTierSchema,
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
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiErrors,
  ApiUuidParam,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { PizzaService } from './pizza.service.js';

const tierDoc = (status: number, description?: string) => ({
  status,
  name: 'PizzaTier',
  schema: pizzaTierSchema,
  description,
});
const flavorDoc = (status: number, description?: string) => ({
  status,
  name: 'PizzaFlavor',
  schema: pizzaFlavorSchema,
  description,
});
const invalidPrices =
  '`VALIDATION_FAILED` — dados inválidos ou preço para produto que não é tamanho de pizza.';

@ApiTags('Pizzaria')
@Controller('pizza')
export class PizzaController {
  constructor(private readonly pizza: PizzaService) {}

  @Get('tiers')
  @ApiOperation({
    summary: 'Lista as faixas de preço com o preço em cada tamanho',
    description:
      'Tamanho = produto com `maxFlavors`. Tamanho sem preço na faixa não oferece os sabores dela.',
  })
  @ApiZodQuery(listPizzaTiersQuerySchema)
  @ApiZodResponse({ ...tierDoc(200), isArray: true })
  listTiers(
    @Query(new ZodValidationPipe(listPizzaTiersQuerySchema))
    query: z.output<typeof listPizzaTiersQuerySchema>,
  ) {
    return this.pizza.listTiers(query);
  }

  @Post('tiers')
  @ApiOperation({ summary: 'Cria faixa de preço' })
  @ApiZodBody(createPizzaTierSchema)
  @ApiZodResponse(tierDoc(201, 'Faixa criada.'))
  @ApiErrors({
    409: '`CONFLICT` — já existe faixa com esse nome.',
    422: invalidPrices,
  })
  createTier(
    @Body(new ZodValidationPipe(createPizzaTierSchema))
    body: z.output<typeof createPizzaTierSchema>,
  ) {
    return this.pizza.createTier(body);
  }

  @Patch('tiers/:id')
  @ApiOperation({
    summary: 'Edita faixa e a tabela de preços',
    description:
      '`prices`, se enviado, substitui a tabela inteira. Mudar preço não afeta pizzas já lançadas (RN02).',
  })
  @ApiUuidParam('id', 'Faixa')
  @ApiZodBody(updatePizzaTierSchema)
  @ApiZodResponse(tierDoc(200, 'Faixa atualizada.'))
  @ApiErrors({
    404: '`NOT_FOUND` — faixa não existe.',
    409: '`CONFLICT` — nome repetido. `PIZZA_TIER_IN_USE` — arquivar faixa com sabores ativos.',
    422: invalidPrices,
  })
  updateTier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePizzaTierSchema))
    body: z.output<typeof updatePizzaTierSchema>,
  ) {
    return this.pizza.updateTier(id, body);
  }

  @Get('flavors')
  @ApiOperation({
    summary: 'Lista os sabores',
    description: 'Na ordem das faixas e depois dos sabores.',
  })
  @ApiZodQuery(listPizzaFlavorsQuerySchema)
  @ApiZodResponse({ ...flavorDoc(200), isArray: true })
  listFlavors(
    @Query(new ZodValidationPipe(listPizzaFlavorsQuerySchema))
    query: z.output<typeof listPizzaFlavorsQuerySchema>,
  ) {
    return this.pizza.listFlavors(query);
  }

  @Post('flavors')
  @ApiOperation({ summary: 'Cria sabor' })
  @ApiZodBody(createPizzaFlavorSchema)
  @ApiZodResponse(flavorDoc(201, 'Sabor criado.'))
  @ApiErrors({
    409: '`CONFLICT` — já existe sabor com esse nome.',
    422: '`VALIDATION_FAILED` — dados inválidos ou faixa inexistente.',
  })
  createFlavor(
    @Body(new ZodValidationPipe(createPizzaFlavorSchema))
    body: z.output<typeof createPizzaFlavorSchema>,
  ) {
    return this.pizza.createFlavor(body);
  }

  @Patch('flavors/:id')
  @ApiOperation({
    summary: 'Edita, marca em falta ou arquiva sabor',
    description: 'Pedidos antigos continuam com o nome e preço gravados.',
  })
  @ApiUuidParam('id', 'Sabor')
  @ApiZodBody(updatePizzaFlavorSchema)
  @ApiZodResponse(flavorDoc(200, 'Sabor atualizado.'))
  @ApiErrors({
    404: '`NOT_FOUND` — sabor não existe.',
    409: '`CONFLICT` — já existe sabor com esse nome.',
    422: '`VALIDATION_FAILED` — dados inválidos ou faixa inexistente.',
  })
  updateFlavor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePizzaFlavorSchema))
    body: z.output<typeof updatePizzaFlavorSchema>,
  ) {
    return this.pizza.updateFlavor(id, body);
  }
}
