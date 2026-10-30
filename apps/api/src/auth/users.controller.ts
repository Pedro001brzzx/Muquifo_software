import {
  type CurrentUser,
  createUserSchema,
  updateUserSchema,
  userSchema,
} from '@muquifo/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiErrors,
  ApiUuidParam,
  ApiZodBody,
  ApiZodResponse,
} from '../openapi/api-docs.js';
import { AuditService } from './audit.service.js';
import { AuthUser, MinRole } from './decorators.js';
import { UsersService } from './users.service.js';

const user = (status: number) => ({
  status,
  name: 'User',
  schema: userSchema,
});

@ApiTags('Equipe')
@MinRole('owner')
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'Equipe (inclui desativados)' })
  @ApiZodResponse({ ...user(200), isArray: true })
  list() {
    return this.users.list();
  }

  @Post('users')
  @ApiOperation({ summary: 'Cadastra alguém da equipe' })
  @ApiZodBody(createUserSchema)
  @ApiZodResponse(user(201))
  @ApiErrors({
    409: '`CONFLICT` — nome repetido, ou PIN igual ao de outro dono.',
    422: '`VALIDATION_FAILED` — dados inválidos.',
  })
  create(
    @Body(new ZodValidationPipe(createUserSchema))
    body: z.output<typeof createUserSchema>,
    @AuthUser() actor: CurrentUser,
  ) {
    return this.users.create(body, actor);
  }

  @Patch('users/:id')
  @ApiOperation({
    summary: 'Altera nome, função, PIN ou desativa',
    description:
      'Trocar PIN ou função, ou desativar, desconecta os aparelhos da pessoa. Sempre fica pelo menos um dono ativo.',
  })
  @ApiUuidParam('id', 'Usuário')
  @ApiZodBody(updateUserSchema)
  @ApiZodResponse(user(200))
  @ApiErrors({
    404: '`NOT_FOUND` — usuário não existe.',
    409: '`VERSION_CONFLICT`, `LAST_OWNER` ou PIN igual ao de outro dono.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema))
    body: z.output<typeof updateUserSchema>,
    @AuthUser() actor: CurrentUser,
  ) {
    return this.users.update(id, body, actor);
  }

  @Get('audit/verify')
  @ApiOperation({
    summary: 'Confere o registro de ações',
    description:
      'Refaz a corrente de hashes; `ok: false` e `brokenAt` indicam linha apagada ou alterada fora do sistema.',
  })
  verifyAudit() {
    return this.audit.verify();
  }
}
