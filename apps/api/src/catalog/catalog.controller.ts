import {
  categorySchema,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  productionSectorSchema,
  productSchema,
  updateCategorySchema,
  updateProductAvailabilitySchema,
  updateProductSchema,
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
const productConflict = [
  '`CONFLICT` — nome já usado na categoria ou código já usado; `details.field` indica qual.',
];

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

  @Patch('categories/:id')
  @ApiOperation({
    summary: 'Edita ou arquiva categoria',
    description:
      'Renomeia, muda a ordem de exibição ou arquiva (`active: false`). Arquivar exige que nenhum produto ativo esteja nela.',
  })
  @ApiUuidParam('id', 'Categoria')
  @ApiZodBody(updateCategorySchema)
  @ApiZodResponse({
    status: 200,
    name: 'Category',
    schema: categorySchema,
    description: 'Categoria atualizada.',
  })
  @ApiErrors({
    404: '`NOT_FOUND` — categoria não existe.',
    409: [
      '`CONFLICT` — já existe categoria com esse nome.',
      '`CATEGORY_IN_USE` — há produtos ativos nela; `details.activeProducts`.',
    ],
    422: invalid,
  })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema))
    body: z.output<typeof updateCategorySchema>,
  ) {
    return this.catalog.updateCategory(id, body);
  }

  @Get('products')
  @ApiOperation({
    summary: 'Lista produtos',
    description:
      'Por padrão só os ativos (o cardápio). `status=archived` ou `all` para a administração.',
  })
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
    409: productConflict,
    422: [
      invalid,
      'Categoria ou setor inexistente.',
      '`CATEGORY_ARCHIVED` — categoria arquivada.',
    ],
  })
  createProduct(
    @Body(new ZodValidationPipe(createProductSchema))
    body: z.output<typeof createProductSchema>,
  ) {
    return this.catalog.createProduct(body);
  }

  @Patch('products/:id')
  @ApiOperation({
    summary: 'Edita produto',
    description:
      'Envie só os campos que mudaram e a `version` atual. Novo preço vale para os próximos lançamentos; itens já lançados mantêm o preço da venda (RN02). `active: false` arquiva (sai do cardápio, segue nos pedidos antigos).',
  })
  @ApiUuidParam('id', 'Produto')
  @ApiZodBody(updateProductSchema)
  @ApiZodResponse({
    status: 200,
    name: 'Product',
    schema: productSchema,
    description: 'Produto atualizado.',
  })
  @ApiErrors({
    404: '`NOT_FOUND` — produto não existe.',
    409: [
      '`VERSION_CONFLICT` — o produto mudou; recarregue e revise.',
      ...productConflict,
    ],
    422: [
      invalid,
      'Categoria ou setor inexistente.',
      '`CATEGORY_ARCHIVED` — categoria arquivada.',
    ],
  })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductSchema))
    body: z.output<typeof updateProductSchema>,
  ) {
    return this.catalog.updateProduct(id, body);
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
