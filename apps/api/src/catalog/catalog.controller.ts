import {
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
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
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('sectors')
  listSectors() {
    return this.catalog.listSectors();
  }

  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  createCategory(
    @Body(new ZodValidationPipe(createCategorySchema))
    body: z.output<typeof createCategorySchema>,
  ) {
    return this.catalog.createCategory(body);
  }

  @Get('products')
  listProducts(
    @Query(new ZodValidationPipe(listProductsQuerySchema))
    query: z.output<typeof listProductsQuerySchema>,
  ) {
    return this.catalog.listProducts(query);
  }

  @Post('products')
  createProduct(
    @Body(new ZodValidationPipe(createProductSchema))
    body: z.output<typeof createProductSchema>,
  ) {
    return this.catalog.createProduct(body);
  }

  @Patch('products/:id/availability')
  setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductAvailabilitySchema))
    body: z.output<typeof updateProductAvailabilitySchema>,
  ) {
    return this.catalog.setAvailability(id, body);
  }
}
