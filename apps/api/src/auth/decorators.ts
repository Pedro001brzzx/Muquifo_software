import type { CurrentUser, UserRole } from '@muquifo/contracts';
import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export const PUBLIC_KEY = 'muquifo:public';
export const MIN_ROLE_KEY = 'muquifo:min-role';
export const APPROVAL_KEY = 'muquifo:approval';

/** Sem login: cardápio do cliente, saúde do servidor e a própria entrada. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Função mínima (garçom < caixa < dono). Sem isto, qualquer usuário logado. */
export const MinRole = (role: UserRole) => SetMetadata(MIN_ROLE_KEY, role);

/**
 * Ação sensível: quem não é dono precisa do PIN de um dono/gerente na hora
 * (cabeçalho x-approval-pin). `action` aparece no pedido de autorização.
 */
export const RequiresApproval = (action: string) =>
  SetMetadata(APPROVAL_KEY, action);

export interface AuthenticatedRequest extends FastifyRequest {
  user?: CurrentUser;
  /** Quem autorizou a ação (o próprio usuário, se for dono). */
  approver?: CurrentUser;
  authToken?: string;
}

/** Usuário logado da requisição. */
export const AuthUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user!,
);

/** Dono/gerente que autorizou a ação (rotas com @RequiresApproval). */
export const Approver = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().approver!,
);
