import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditService } from './audit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/** Global: o registro de ações é usado pelos módulos de pedidos e caixa. */
@Global()
@Module({
  controllers: [AuthController, UsersController],
  providers: [
    AuditService,
    AuthService,
    UsersService,
    // Toda rota exige login, salvo as marcadas com @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuditService, AuthService],
})
export class AuthModule {}
