import {
  type CreateUserInput,
  type CurrentUser,
  errorCodes,
  type UpdateUserInput,
  type User,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { AppException } from '../common/app-exception.js';
import type { Database } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { users } from '../db/schema.js';
import { AuditService } from './audit.service.js';
import { AuthService } from './auth.service.js';
import { hashSecret } from './secrets.js';

const columns = {
  id: users.id,
  name: users.name,
  role: users.role,
  active: users.active,
  lockedUntil: users.lockedUntil,
  version: users.version,
};

const toUser = (row: {
  id: string;
  name: string;
  role: User['role'];
  active: boolean;
  lockedUntil: Date | null;
  version: number;
}): User => ({
  ...row,
  lockedUntil:
    row.lockedUntil && row.lockedUntil > new Date()
      ? row.lockedUntil.toISOString()
      : null,
});

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<User[]> {
    const rows = await this.db
      .select(columns)
      .from(users)
      .orderBy(asc(users.name));
    return rows.map(toUser);
  }

  async create(input: CreateUserInput, actor: CurrentUser): Promise<User> {
    if (input.role === 'owner') await this.auth.assertOwnerPinFree(input.pin);
    const pinHash = await hashSecret(input.pin);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ name: input.name, role: input.role, pinHash })
        .returning(columns);
      await this.audit.record(
        {
          action: 'user_created',
          actorId: actor.id,
          target: row.id,
          details: { name: row.name, role: row.role },
        },
        tx,
      );
      return toUser(row);
    });
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actor: CurrentUser,
  ): Promise<User> {
    const [current] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id));
    if (!current) throw AppException.notFound('Usuário', id);
    if (current.version !== input.version) {
      throw AppException.versionConflict('Usuário', current.version);
    }
    const role = input.role ?? current.role;
    const active = input.active ?? current.active;

    // Nunca ficar sem nenhum dono ativo: ninguém mais conseguiria administrar.
    if (
      current.role === 'owner' &&
      current.active &&
      (role !== 'owner' || !active)
    ) {
      const [other] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, 'owner'),
            eq(users.active, true),
            ne(users.id, id),
          ),
        )
        .limit(1);
      if (!other) {
        throw new AppException(
          HttpStatus.CONFLICT,
          errorCodes.lastOwner,
          'É preciso ter pelo menos um dono/gerente ativo. Cadastre outro antes.',
        );
      }
    }
    if (role === 'owner' && active && input.pin) {
      await this.auth.assertOwnerPinFree(input.pin, id);
    }
    const pinHash = input.pin ? await hashSecret(input.pin) : undefined;

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          name: input.name,
          role,
          active,
          ...(pinHash ? { pinHash, failedAttempts: 0, lockedUntil: null } : {}),
          version: sql`${users.version} + 1`,
        })
        .where(and(eq(users.id, id), eq(users.version, input.version)))
        .returning(columns);
      if (!row) throw AppException.versionConflict('Usuário');
      // PIN trocado, função mudada ou desativado: os aparelhos entram de novo.
      if (pinHash || !active || role !== current.role) {
        await this.auth.revokeAll(tx, id);
      }
      await this.audit.record(
        {
          action: 'user_updated',
          actorId: actor.id,
          target: id,
          details: {
            ...(input.name && input.name !== current.name
              ? { name: [current.name, input.name] }
              : {}),
            ...(role !== current.role ? { role: [current.role, role] } : {}),
            ...(active !== current.active ? { active } : {}),
            ...(pinHash ? { pin: 'trocado' } : {}),
          },
        },
        tx,
      );
      return toUser(row);
    });
  }
}
