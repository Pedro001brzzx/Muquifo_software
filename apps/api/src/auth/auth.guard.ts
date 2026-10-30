import {
  APPROVAL_HEADER,
  errorCodes,
  hasRole,
  type UserRole,
  userRoleLabel,
} from '@muquifo/contracts';
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../common/app-exception.js';
import { AuthService } from './auth.service.js';
import {
  APPROVAL_KEY,
  type AuthenticatedRequest,
  MIN_ROLE_KEY,
  PUBLIC_KEY,
} from './decorators.js';

/** Token do cabeçalho Authorization: Bearer <token>. */
export function bearerToken(request: AuthenticatedRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Global: toda rota exige login, salvo @Public. Confere a função mínima
 * (@MinRole) e, em ações sensíveis (@RequiresApproval), o PIN do gerente
 * quando quem pede não é dono.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = bearerToken(request);
    const user = token ? await this.auth.authenticate(token) : null;
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        errorCodes.unauthorized,
        'Entre com seu PIN.',
      );
    }
    request.user = user;
    request.authToken = token!;

    const minRole = this.reflector.getAllAndOverride<UserRole | undefined>(
      MIN_ROLE_KEY,
      targets,
    );
    if (minRole && !hasRole(user.role, minRole)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        errorCodes.forbidden,
        `Só ${userRoleLabel[minRole].toLowerCase()} ou acima pode fazer isso.`,
        { minRole },
      );
    }

    const action = this.reflector.getAllAndOverride<string | undefined>(
      APPROVAL_KEY,
      targets,
    );
    if (action) {
      if (user.role === 'owner') {
        request.approver = user;
      } else {
        const pin = request.headers[APPROVAL_HEADER];
        if (typeof pin !== 'string' || pin.length === 0) {
          throw new AppException(
            HttpStatus.FORBIDDEN,
            errorCodes.approvalRequired,
            `Precisa do PIN de um dono/gerente: ${action}.`,
            { action },
          );
        }
        request.approver = await this.auth.approve(pin, request.ip);
      }
    }
    return true;
  }
}
