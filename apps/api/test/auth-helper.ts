import { randomUUID } from 'node:crypto';
import type { UserRole } from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashSecret } from '../src/auth/secrets.js';
import type { Database } from '../src/db/client.js';
import { DB } from '../src/db/database.module.js';
import { users } from '../src/db/schema.js';

export interface TestUser {
  id: string;
  name: string;
  role: UserRole;
  pin: string;
  token: string;
}

/** Cria alguém da equipe direto no banco e uma sessão para ele. */
export async function createTestUser(
  app: NestFastifyApplication,
  role: UserRole,
  pin = String(Math.floor(100_000 + Math.random() * 900_000)),
): Promise<TestUser> {
  const db = app.get<Database>(DB);
  const name = `${role} ${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ name, role, pinHash: await hashSecret(pin) })
    .returning({ id: users.id, name: users.name, role: users.role });
  const session = await app
    .get(AuthService)
    .issue(db, user, { ip: '127.0.0.1' });
  return { ...user, pin, token: session.token };
}

/**
 * App de teste já logado: toda requisição sem Authorization recebe a sessão
 * de um usuário com a função pedida (dono, por padrão).
 */
export async function createTestApp(
  role: UserRole = 'owner',
): Promise<NestFastifyApplication> {
  const app = await createApp({ logger: false });
  const user = await createTestUser(app, role);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request) => {
      request.headers.authorization ??= `Bearer ${user.token}`;
    });
  // A aplicação do Nest é um proxy que não aceita propriedades novas.
  testUsers.set(app, user);
  return app;
}

const testUsers = new WeakMap<NestFastifyApplication, TestUser>();

/** Usuário logado de um app criado por createTestApp. */
export const testUserOf = (app: NestFastifyApplication) => testUsers.get(app)!;

export const bearer = (user: Pick<TestUser, 'token'>) => ({
  authorization: `Bearer ${user.token}`,
});
