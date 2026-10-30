import { dashboardQuerySchema, dashboardSchema } from '@muquifo/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { MinRole } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodQuery, ApiZodResponse } from '../openapi/api-docs.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Painel')
@MinRole('owner')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Números do dia e pontos de atenção',
    description:
      'Vendas (itens enviados), ticket médio, formas de pagamento, vendas por hora, mais vendidos, contas abertas, caixa atual e possíveis desvios: cancelamentos depois de enviar, estornos, mesas liberadas e diferenças de caixa.',
  })
  @ApiZodQuery(dashboardQuerySchema)
  @ApiZodResponse({ status: 200, name: 'Dashboard', schema: dashboardSchema })
  day(
    @Query(new ZodValidationPipe(dashboardQuerySchema))
    query: z.output<typeof dashboardQuerySchema>,
  ) {
    return this.dashboard.day(query.date);
  }
}
