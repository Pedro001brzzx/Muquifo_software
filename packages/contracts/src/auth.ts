import { z } from 'zod';

/**
 * Equipe e acesso por PIN. Cada aparelho entra com um usuário (toca no nome
 * e digita o PIN); ações sensíveis feitas por quem não é dono pedem o PIN de
 * um dono/gerente na hora (cabeçalho APPROVAL_HEADER).
 */

export const userRoleSchema = z.enum(['owner', 'cashier', 'waiter']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userRoleLabel: Record<UserRole, string> = {
  owner: 'Dono / gerente',
  cashier: 'Caixa',
  waiter: 'Garçom',
};

/** Garçom < caixa < dono: cada função pode tudo o que as de baixo podem. */
export const roleRank: Record<UserRole, number> = {
  waiter: 1,
  cashier: 2,
  owner: 3,
};

export const hasRole = (role: UserRole, minimum: UserRole) =>
  roleRank[role] >= roleRank[minimum];

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, 'O PIN tem de 4 a 6 números.');

const nameSchema = z.string().trim().min(1).max(40);

/** Cabeçalho com o PIN de um dono/gerente que autoriza a ação. */
export const APPROVAL_HEADER = 'x-approval-pin';

/** Quem aparece na tela de entrada (sem dados sensíveis). */
export const loginUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: userRoleSchema,
});
export type LoginUser = z.infer<typeof loginUserSchema>;

export const authStatusSchema = z.object({
  /** Nenhum usuário ainda: criar o primeiro dono. */
  setupRequired: z.boolean(),
  /** Este aparelho pode fazer a configuração inicial (só o computador do servidor). */
  canSetup: z.boolean(),
  users: z.array(loginUserSchema),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const currentUserSchema = loginUserSchema;
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const sessionSchema = z.object({
  /** Vai no cabeçalho Authorization: Bearer <token>. */
  token: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  user: currentUserSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const loginSchema = z.object({
  userId: z.uuid(),
  pin: pinSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  name: nameSchema,
  pin: pinSchema,
});
export type SetupInput = z.infer<typeof setupSchema>;

export const setupResultSchema = sessionSchema.extend({
  /** Mostrado uma única vez: troca o PIN de um dono que esqueceu. */
  recoveryCode: z.string(),
});
export type SetupResult = z.infer<typeof setupResultSchema>;

export const recoverSchema = z.object({
  userId: z.uuid(),
  recoveryCode: z.string().trim().min(1).max(40),
  pin: pinSchema,
});
export type RecoverInput = z.infer<typeof recoverSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: userRoleSchema,
  active: z.boolean(),
  /** Bloqueado por PIN errado demais até este horário. */
  lockedUntil: z.iso.datetime({ offset: true }).nullable(),
  version: z.number().int(),
});
export type User = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  name: nameSchema,
  role: userRoleSchema,
  pin: pinSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  version: z.number().int().positive(),
  name: nameSchema.optional(),
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
  pin: pinSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
