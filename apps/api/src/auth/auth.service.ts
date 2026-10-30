import {
  type AuthStatus,
  type CurrentUser,
  errorCodes,
  type LoginInput,
  type RecoverInput,
  roleRank,
  type Session,
  type SetupInput,
  type SetupResult,
} from '@muquifo/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AppException } from '../common/app-exception.js';
import type { Database, Executor } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { authSessions, restaurant, users } from '../db/schema.js';
import { AuditService } from './audit.service.js';
import {
  hashSecret,
  hashToken,
  newRecoveryCode,
  newToken,
  normalizeRecoveryCode,
  verifySecret,
} from './secrets.js';

/** Um turno longo; depois disso entra de novo com o PIN. */
const SESSION_HOURS = 16;
/** Aparelho parado por mais que isso também precisa do PIN de novo. */
const IDLE_HOURS = 8;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

export interface RequestMeta {
  ip: string;
  userAgent?: string;
}

/** Só o computador onde o Muquifo está instalado faz a configuração inicial. */
export const isLoopback = (ip: string) =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Tentativas erradas por aparelho (aprovação e recuperação), em memória. */
class Throttle {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  blocked(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string) {
    this.hits.set(key, [...(this.hits.get(key) ?? []), Date.now()]);
  }
}

const invalidPin = (details?: unknown) =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    errorCodes.invalidPin,
    'PIN incorreto.',
    details,
  );

@Injectable()
export class AuthService {
  private readonly approvalThrottle = new Throttle(MAX_ATTEMPTS, 5 * 60_000);
  private readonly recoveryThrottle = new Throttle(MAX_ATTEMPTS, 15 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async status(meta: RequestMeta): Promise<AuthStatus> {
    const rows = await this.db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name));
    const setupRequired = !(await this.anyUser());
    return {
      setupRequired,
      canSetup: setupRequired && isLoopback(meta.ip),
      // Donos primeiro, depois caixa e garçons: quem mais usa o aparelho do caixa.
      users: rows.sort((a, b) => roleRank[b.role] - roleRank[a.role]),
    };
  }

  /** Primeiro dono. Só sem nenhum usuário e só no computador do servidor. */
  async setup(input: SetupInput, meta: RequestMeta): Promise<SetupResult> {
    if (!isLoopback(meta.ip)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        errorCodes.forbidden,
        'Faça a configuração inicial no computador onde o Muquifo está instalado.',
      );
    }
    const recoveryCode = newRecoveryCode();
    const recoveryHash = await hashSecret(normalizeRecoveryCode(recoveryCode));
    const pinHash = await hashSecret(input.pin);
    return this.db.transaction(async (tx) => {
      // Trava para dois "primeiros donos" ao mesmo tempo não passarem juntos.
      await tx.execute(sql`lock table ${users} in exclusive mode`);
      if (await this.anyUser(tx)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          errorCodes.conflict,
          'O Muquifo já foi configurado. Entre com seu PIN.',
        );
      }
      const [user] = await tx
        .insert(users)
        .values({ name: input.name, role: 'owner', pinHash })
        .returning({ id: users.id, name: users.name, role: users.role });
      await tx.insert(restaurant).values({ id: 1 }).onConflictDoNothing();
      await tx
        .update(restaurant)
        .set({ recoveryCodeHash: recoveryHash })
        .where(eq(restaurant.id, 1));
      await this.audit.record(
        { action: 'setup', actorId: user.id, details: { ip: meta.ip } },
        tx,
      );
      return { ...(await this.issue(tx, user, meta)), recoveryCode };
    });
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<Session> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.active, true)));
    if (!user) throw invalidPin();
    this.assertNotLocked(user.lockedUntil);

    if (!(await verifySecret(input.pin, user.pinHash))) {
      const attempts = user.failedAttempts + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      const lockedUntil = lock
        ? new Date(Date.now() + LOCK_MINUTES * 60_000)
        : null;
      await this.db
        .update(users)
        .set({ failedAttempts: lock ? 0 : attempts, lockedUntil })
        .where(eq(users.id, user.id));
      await this.audit.record({
        action: lock ? 'login_locked' : 'login_failed',
        target: user.id,
        details: { ip: meta.ip },
      });
      if (lockedUntil) this.assertNotLocked(lockedUntil);
      throw invalidPin({ attemptsLeft: MAX_ATTEMPTS - attempts });
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
      await this.audit.record(
        { action: 'login', actorId: user.id, details: { ip: meta.ip } },
        tx,
      );
      return this.issue(tx, user, meta);
    });
  }

  /** Dono que esqueceu o PIN: código de recuperação + PIN novo. */
  async recover(input: RecoverInput, meta: RequestMeta): Promise<Session> {
    if (this.recoveryThrottle.blocked(meta.ip)) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        errorCodes.pinLocked,
        'Muitas tentativas. Espere 15 minutos e tente de novo.',
      );
    }
    const [settings] = await this.db
      .select({ hash: restaurant.recoveryCodeHash })
      .from(restaurant)
      .where(eq(restaurant.id, 1));
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.active, true)));
    const valid =
      settings?.hash != null &&
      user?.role === 'owner' &&
      (await verifySecret(
        normalizeRecoveryCode(input.recoveryCode),
        settings.hash,
      ));
    if (!valid || !user) {
      this.recoveryThrottle.fail(meta.ip);
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        errorCodes.invalidPin,
        'Código de recuperação incorreto (só vale para donos).',
      );
    }
    await this.assertOwnerPinFree(input.pin, user.id);
    const pinHash = await hashSecret(input.pin);
    return this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          pinHash,
          failedAttempts: 0,
          lockedUntil: null,
          version: sql`${users.version} + 1`,
        })
        .where(eq(users.id, user.id));
      await this.revokeAll(tx, user.id);
      await this.audit.record(
        { action: 'pin_recovered', actorId: user.id, details: { ip: meta.ip } },
        tx,
      );
      return this.issue(tx, user, meta);
    });
  }

  /** Usuário do token, ou nulo se o token não vale mais. */
  async authenticate(token: string): Promise<CurrentUser | null> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: authSessions.id,
        lastSeenAt: authSessions.lastSeenAt,
        id: users.id,
        name: users.name,
        role: users.role,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.tokenHash, hashToken(token)),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
          eq(users.active, true),
        ),
      );
    if (!row) return null;
    if (now.getTime() - row.lastSeenAt.getTime() > IDLE_HOURS * 3_600_000) {
      return null;
    }
    // Atualiza "visto por último" no máximo uma vez por minuto.
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.db
        .update(authSessions)
        .set({ lastSeenAt: now })
        .where(eq(authSessions.id, row.sessionId));
    }
    return { id: row.id, name: row.name, role: row.role };
  }

  async logout(token: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.tokenHash, hashToken(token)));
  }

  /**
   * Autorização na hora: o PIN de qualquer dono/gerente ativo. Devolve quem
   * aprovou. PINs de donos são únicos entre si, então não há ambiguidade.
   */
  async approve(pin: string, ip: string): Promise<CurrentUser> {
    if (this.approvalThrottle.blocked(ip)) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        errorCodes.pinLocked,
        'PIN do gerente errado muitas vezes. Espere 5 minutos.',
      );
    }
    const owners = await this.db
      .select()
      .from(users)
      .where(and(eq(users.role, 'owner'), eq(users.active, true)));
    for (const owner of owners) {
      if (await verifySecret(pin, owner.pinHash)) {
        return { id: owner.id, name: owner.name, role: owner.role };
      }
    }
    this.approvalThrottle.fail(ip);
    throw new AppException(
      HttpStatus.FORBIDDEN,
      errorCodes.invalidPin,
      'PIN do gerente incorreto.',
    );
  }

  /** Dois donos com o mesmo PIN deixariam a aprovação ambígua. */
  async assertOwnerPinFree(pin: string, exceptUserId?: string) {
    const owners = await this.db
      .select({ id: users.id, pinHash: users.pinHash })
      .from(users)
      .where(and(eq(users.role, 'owner'), eq(users.active, true)));
    for (const owner of owners) {
      if (owner.id === exceptUserId) continue;
      if (await verifySecret(pin, owner.pinHash)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          errorCodes.conflict,
          'Outro dono/gerente já usa esse PIN. Escolha outro.',
          { field: 'pin' },
        );
      }
    }
  }

  async revokeAll(executor: Executor, userId: string) {
    await executor
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
      );
  }

  /** Cria a sessão de um aparelho. */
  async issue(
    executor: Executor,
    user: CurrentUser,
    meta: RequestMeta,
  ): Promise<Session> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
    await executor.insert(authSessions).values({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, name: user.name, role: user.role },
    };
  }

  private assertNotLocked(lockedUntil: Date | null) {
    if (lockedUntil && lockedUntil > new Date()) {
      const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        errorCodes.pinLocked,
        `PIN errado muitas vezes. Tente de novo em ${minutes} min.`,
        { lockedUntil: lockedUntil.toISOString() },
      );
    }
  }

  private async anyUser(executor: Executor = this.db) {
    const [row] = await executor.select({ id: users.id }).from(users).limit(1);
    return row !== undefined;
  }
}
