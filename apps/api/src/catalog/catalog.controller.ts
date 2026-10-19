import {
  categorySchema,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  productionSectorSchema,
  productSchema,
  updateProductAvailabilitySchema,
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
import { CatalogService } from './catalog.service.js';

const invalid = '`VALIDATION_FAILED` — dados inválidos.';

@ApiTags('Cardápio')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('sectors')
  @ApiOperation({
    summary: 'Lista setores de produção',
    description: 'Cozinha, bar, pizzaria… Define para onde vai cada item.',
  })
  @ApiZodResponse({
    status: 200,
    name: 'ProductionSector',
    schema: productionSectorSchema,
    isArray: true,
  })
  listSectors() {
    return this.catalog.listSectors();
  }

  @Get('categories')
  @ApiOperation({ summary: 'Lista categorias' })
  @ApiZodResponse({
    status: 200,
    name: 'Category',
    schema: categorySchema,
    isArray: true,
  })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @ApiOperation({ summary: 'Cria categoria' })
  @ApiZodBody(createCategorySchema)
  @ApiZodResponse({
    status: 201,
    name: 'Category',
    schema: categorySchema,
    description: 'Categoria criada.',
  })
  @ApiErrors({
    409: '`CONFLICT` — já existe categoria com esse nome.',
    422: invalid,
  })
  createCategory(
    @Body(new ZodValidationPipe(createCategorySchema))
    body: z.output<typeof createCategorySchema>,
  ) {
    return this.catalog.createCategory(body);
  }

  @Get('products')
  @ApiOperation({ summary: 'Lista produtos' })
  @ApiZodQuery(listProductsQuerySchema)
  @ApiZodResponse({
    status: 200,
    name: 'Product',
    schema: productSchema,
    isArray: true,
  })
  @ApiErrors({ 422: '`VALIDATION_FAILED` — filtro inválido.' })
  listProducts(
    @Query(new ZodValidationPipe(listProductsQuerySchema))
    query: z.output<typeof listProductsQuerySchema>,
  ) {
    return this.catalog.listProducts(query);
  }

  @Post('products')
  @ApiOperation({
    summary: 'Cria produto',
    description:
      '`priceCents` em centavos (`3990` = R$ 39,90). `allowFractional` libera quantidade com até 3 casas (ex.: por quilo).',
  })
  @ApiZodBody(createProductSchema)
  @ApiZodResponse({
    status: 201,
    name: 'Product',
    schema: productSchema,
    description: 'Produto criado.',
  })
  @ApiErrors({
    409: '`CONFLICT` — já existe produto com esse nome na categoria.',
    422: [invalid, 'Categoria ou setor inexistente.'],
  })
  createProduct(
    @Body(new ZodValidationPipe(createProductSchema))
    body: z.output<typeof createProductSchema>,
  ) {
    return this.catalog.createProduct(body);
  }

  @Patch('products/:id/availability')
  @ApiOperation({
    summary: 'Marca produto como disponível ou esgotado',
    description: 'Envie a `version` atual do produto (concorrência otimista).',
  })
  @ApiUuidParam('id', 'Produto')
  @ApiZodBody(updateProductAvailabilitySchema)
  @ApiZodResponse({
    status: 200,
    name: 'Product',
    schema: productSchema,
    description: 'Produto atualizado.',
  })
  @ApiErrors({
    404: '`NOT_FOUND` — produto não existe.',
    409: '`VERSION_CONFLICT` — o produto mudou; recarregue e tente de novo.',
    422: invalid,
  })
  setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductAvailabilitySchema))
    body: z.output<typeof updateProductAvailabilitySchema>,
  ) {
    return this.catalog.setAvailability(id, body);
  }
}
