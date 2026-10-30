import {
  authStatusSchema,
  type CurrentUser,
  currentUserSchema,
  loginSchema,
  recoverSchema,
  sessionSchema,
  setupResultSchema,
  setupSchema,
} from '@muquifo/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../openapi/api-docs.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { type AuthenticatedRequest, AuthUser, Public } from './decorators.js';

const meta = (request: AuthenticatedRequest): RequestMeta => ({
  ip: request.ip,
  userAgent: request.headers['user-agent'],
});

@ApiTags('Acesso')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('status')
  @ApiOperation({
    summary: 'Tela de entrada',
    description:
      'Quem pode entrar (nome e função) e se falta a configuração inicial. `canSetup` só é verdadeiro no computador do servidor.',
  })
  @ApiZodResponse({ status: 200, name: 'AuthStatus', schema: authStatusSchema })
  status(@Req() request: AuthenticatedRequest) {
    return this.auth.status(meta(request));
  }

  @Public()
  @Post('setup')
  @ApiOperation({
    summary: 'Cria o primeiro dono',
    description:
      'Só quando não há nenhum usuário e só pelo computador do servidor. Devolve a sessão e o código de recuperação (mostrado uma única vez).',
  })
  @ApiZodBody(setupSchema)
  @ApiZodResponse({
    status: 201,
    name: 'SetupResult',
    schema: setupResultSchema,
  })
  @ApiErrors({
    403: '`FORBIDDEN` — fora do computador do servidor.',
    409: '`CONFLICT` — já configurado.',
  })
  setup(
    @Body(new ZodValidationPipe(setupSchema))
    body: z.output<typeof setupSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.setup(body, meta(request));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Entra com nome e PIN',
    description:
      'Cinco PINs errados seguidos bloqueiam o usuário por 5 minutos. O token vai em `Authorization: Bearer`.',
  })
  @ApiZodBody(loginSchema)
  @ApiZodResponse({ status: 200, name: 'Session', schema: sessionSchema })
  @ApiErrors({
    401: '`INVALID_PIN` — PIN errado; `details.attemptsLeft`.',
    429: '`PIN_LOCKED` — bloqueado; `details.lockedUntil`.',
  })
  login(
    @Body(new ZodValidationPipe(loginSchema))
    body: z.output<typeof loginSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.login(body, meta(request));
  }

  @Public()
  @Post('recover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dono esqueceu o PIN',
    description:
      'Com o código de recuperação da configuração inicial, define um PIN novo e entra.',
  })
  @ApiZodBody(recoverSchema)
  @ApiZodResponse({ status: 200, name: 'Session', schema: sessionSchema })
  @ApiErrors({
    401: '`INVALID_PIN` — código errado ou usuário não é dono.',
    429: '`PIN_LOCKED` — tentativas demais.',
  })
  recover(
    @Body(new ZodValidationPipe(recoverSchema))
    body: z.output<typeof recoverSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.recover(body, meta(request));
  }

  @Get('me')
  @ApiOperation({ summary: 'Quem está logado neste aparelho' })
  @ApiZodResponse({
    status: 200,
    name: 'CurrentUser',
    schema: currentUserSchema,
  })
  me(@AuthUser() user: CurrentUser) {
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sai (ou troca de usuário) neste aparelho' })
  async logout(@Req() request: AuthenticatedRequest) {
    await this.auth.logout(request.authToken!);
  }
}
