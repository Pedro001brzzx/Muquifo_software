import {
  createOptionGroupSchema,
  listOptionGroupsQuerySchema,
  optionGroupSchema,
  updateOptionGroupSchema,
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
import { OptionGroupsService } from './option-groups.service.js';

const group = (status: number, description?: string) => ({
  status,
  name: 'OptionGroup',
  schema: optionGroupSchema,
  description,
});
const invalid =
  '`VALIDATION_FAILED` — dados inválidos (mínimo/máximo, nomes repetidos).';
const duplicate = '`CONFLICT` — já existe um grupo com esse nome.';

@ApiTags('Complementos')
@Controller('option-groups')
export class OptionGroupsController {
  constructor(private readonly groups: OptionGroupsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista grupos de complementos',
    description:
      'Com as opções ativas e onde cada grupo está ligado. Padrão: só ativos.',
  })
  @ApiZodQuery(listOptionGroupsQuerySchema)
  @ApiZodResponse({ ...group(200), isArray: true })
  list(
    @Query(new ZodValidationPipe(listOptionGroupsQuerySchema))
    query: z.output<typeof listOptionGroupsQuerySchema>,
  ) {
    return this.groups.list(query);
  }

  @MinRole('owner')
  @Post()
  @ApiOperation({
    summary: 'Cria grupo de complementos',
    description:
      '`minSelect` 0 = opcional; 1 ou mais = obrigatório. Ex.: Ponto da carne (1 a 1), Adicionais (0 a 5). Ligue o grupo a produtos ou categorias pela edição deles.',
  })
  @ApiZodBody(createOptionGroupSchema)
  @ApiZodResponse(group(201, 'Grupo criado.'))
  @ApiErrors({ 409: duplicate, 422: invalid })
  create(
    @Body(new ZodValidationPipe(createOptionGroupSchema))
    body: z.output<typeof createOptionGroupSchema>,
  ) {
    return this.groups.create(body);
  }

  @MinRole('owner')
  @Patch(':id')
  @ApiOperation({
    summary: 'Edita grupo de complementos',
    description:
      'Com a `version` atual. `options` é a lista completa: com `id` altera, sem `id` cria, e as que ficarem de fora são arquivadas (seguem nos pedidos antigos). `active: false` arquiva o grupo inteiro.',
  })
  @ApiUuidParam('id', 'Grupo')
  @ApiZodBody(updateOptionGroupSchema)
  @ApiZodResponse(group(200, 'Grupo atualizado.'))
  @ApiErrors({
    404: '`NOT_FOUND` — grupo não existe.',
    409: [
      '`VERSION_CONFLICT` — o grupo mudou; recarregue e revise.',
      duplicate,
    ],
    422: [invalid, 'Opção de outro grupo.'],
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOptionGroupSchema))
    body: z.output<typeof updateOptionGroupSchema>,
  ) {
    return this.groups.update(id, body);
  }
}
