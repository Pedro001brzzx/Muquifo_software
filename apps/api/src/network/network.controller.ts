import { networkSchema, publishAddressSchema } from '@muquifo/contracts';
import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { MinRole } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../openapi/api-docs.js';
import { NetworkService } from './network.service.js';

@ApiTags('Rede local')
@MinRole('owner')
@Controller('network')
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  @Get()
  @ApiOperation({
    summary: 'Endereços e roteador desta máquina',
    description:
      'IPv4 das placas (a primeira é a que os celulares usam), roteador, MAC e se o IP vem do DHCP — o necessário para reservar o IP no roteador. `addressChanged` avisa quando o IP dos QR codes deixou de ser desta máquina.',
  })
  @ApiZodResponse({ status: 200, name: 'Network', schema: networkSchema })
  get() {
    return this.network.get();
  }

  @Put('published')
  @ApiOperation({
    summary: 'Define o IP dos QR codes e celulares',
    description:
      'Usado ao imprimir os QR codes, ao aceitar um IP novo e ao confirmar a reserva no roteador (`reserved: true`).',
  })
  @ApiZodBody(publishAddressSchema)
  @ApiZodResponse({ status: 200, name: 'Network', schema: networkSchema })
  @ApiErrors({
    422: '`VALIDATION_FAILED` — IP inválido ou que não é desta máquina.',
  })
  publish(
    @Body(new ZodValidationPipe(publishAddressSchema))
    body: z.output<typeof publishAddressSchema>,
  ) {
    return this.network.publish(body);
  }

  @Delete('pending-change')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marca o aviso de troca de IP como visto',
    description:
      'O servidor segue sozinho o IP novo quando o roteador troca o desta máquina e avisa em `pendingChange` até o dono confirmar que viu.',
  })
  @ApiZodResponse({ status: 200, name: 'Network', schema: networkSchema })
  acknowledgeChange() {
    return this.network.acknowledgeChange();
  }
}
