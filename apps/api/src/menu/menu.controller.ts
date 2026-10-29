import { publicMenuSchema } from '@muquifo/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodResponse } from '../openapi/api-docs.js';
import { MenuService } from './menu.service.js';

@ApiTags('Cardápio público')
@Controller()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('menu')
  @ApiOperation({
    summary: 'Cardápio para o cliente (QR code)',
    description:
      'Nome do restaurante, categorias ativas com itens ativos, figuras, ingredientes, extras e a tabela da pizzaria. Esgotados vêm com `available: false`.',
  })
  @ApiZodResponse({ status: 200, name: 'PublicMenu', schema: publicMenuSchema })
  publicMenu() {
    return this.menu.publicMenu();
  }
}
