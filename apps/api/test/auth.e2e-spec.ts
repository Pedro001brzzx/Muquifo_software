import { randomUUID } from 'node:crypto';
import type {
  ApiError,
  AuthStatus,
  CashSession,
  Category,
  CurrentCash,
  Order,
  Product,
  Session,
  SetupResult,
  TabDetail,
  User,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.factory.js';
import type { Database } from '../src/db/client.js';
import { DB } from '../src/db/database.module.js';

/** PIN, funções, aprovação do gerente, recuperação e registro encadeado. */
describe.skipIf(!process.env.DATABASE_URL)('Acesso por PIN (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: SetupResult;
  const ownerPin = '4321';

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    options: {
      token?: string;
      payload?: object;
      approval?: string;
      ip?: string;
    } = {},
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload: options.payload,
      remoteAddress: options.ip ?? '127.0.0.1',
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.approval ? { 'x-approval-pin': options.approval } : {}),
        ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
      },
    });

  const login = (userId: string, pin: string) =>
    call('POST', '/auth/login', { payload: { userId, pin } });

  const addUser = async (role: User['role'], pin: string) =>
    (
      await call('POST', '/users', {
        token: owner.token,
        payload: { name: `${role} ${randomUUID().slice(0, 6)}`, role, pin },
      })
    ).json<User>();

  const session = async (user: User, pin: string) =>
    (await login(user.id, pin)).json<Session>().token;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    // Começa como uma instalação nova: sem equipe.
    await app
      .get<Database>(DB)
      .execute(sql`truncate users, auth_sessions, audit_events cascade`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('configuração inicial só no computador do servidor e só uma vez', async () => {
    const status = (await call('GET', '/auth/status')).json<AuthStatus>();
    expect(status).toMatchObject({ setupRequired: true, canSetup: true });
    expect(
      (
        await call('GET', '/auth/status', { ip: '192.168.0.50' })
      ).json<AuthStatus>().canSetup,
    ).toBe(false);

    const remote = await call('POST', '/auth/setup', {
      ip: '192.168.0.50',
      payload: { name: 'Dono', pin: ownerPin },
    });
    expect(remote.statusCode).toBe(403);

    const res = await call('POST', '/auth/setup', {
      payload: { name: 'Dono', pin: ownerPin },
    });
    expect(res.statusCode).toBe(201);
    owner = res.json<SetupResult>();
    expect(owner.user.role).toBe('owner');
    expect(owner.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const again = await call('POST', '/auth/setup', {
      payload: { name: 'Outro', pin: '1111' },
    });
    expect(again.statusCode).toBe(409);
    const after = (await call('GET', '/auth/status')).json<AuthStatus>();
    expect(after.setupRequired).toBe(false);
    expect(after.users.map((u) => u.name)).toEqual(['Dono']);
  });

  it('exige login, exceto cardápio e saúde do servidor', async () => {
    const res = await call('GET', '/tables');
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiError>().code).toBe('UNAUTHORIZED');
    expect(
      (await call('GET', '/tables', { token: 'inventado' })).statusCode,
    ).toBe(401);
    expect((await call('GET', '/menu')).statusCode).toBe(200);
    expect((await call('GET', '/health')).statusCode).toBe(200);
    expect(
      (await call('GET', '/auth/me', { token: owner.token })).json(),
    ).toMatchObject({
      name: 'Dono',
      role: 'owner',
    });
  });

  it('bloqueia depois de 5 PINs errados', async () => {
    const waiter = await addUser('waiter', '1234');
    const first = await login(waiter.id, '0000');
    expect(first.statusCode).toBe(401);
    expect(first.json<ApiError>()).toMatchObject({
      code: 'INVALID_PIN',
      details: { attemptsLeft: 4 },
    });
    for (let i = 0; i < 3; i++) await login(waiter.id, '0000');
    const locked = await login(waiter.id, '0000');
    expect(locked.statusCode).toBe(429);
    expect(locked.json<ApiError>().code).toBe('PIN_LOCKED');
    // Nem o PIN certo entra enquanto estiver bloqueado.
    expect((await login(waiter.id, '1234')).statusCode).toBe(429);

    // Dono troca o PIN: desbloqueia na hora.
    const unlocked = await call('PATCH', `/users/${waiter.id}`, {
      token: owner.token,
      payload: { version: waiter.version, pin: '5678' },
    });
    expect(unlocked.json<User>().lockedUntil).toBeNull();
    expect((await login(waiter.id, '5678')).statusCode).toBe(200);
  });

  it('cada função só faz o que pode', async () => {
    const waiter = await addUser('waiter', '2222');
    const cashier = await addUser('cashier', '3333');
    const w = await session(waiter, '2222');
    const c = await session(cashier, '3333');

    expect((await call('GET', '/tables', { token: w })).statusCode).toBe(200);
    expect((await call('GET', '/products', { token: w })).statusCode).toBe(200);
    for (const [method, url] of [
      ['POST', '/categories'],
      ['GET', '/dashboard'],
      ['GET', '/cash/current'],
      ['GET', '/users'],
      ['GET', '/network'],
    ] as const) {
      const res = await call(method, url, { token: w, payload: { name: 'x' } });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json<ApiError>().code).toBe('FORBIDDEN');
    }
    expect((await call('GET', '/dashboard', { token: c })).statusCode).toBe(
      403,
    );

    // Fechamento cego: o caixa não vê o esperado com o caixa aberto; o dono vê.
    const open = (
      await call('GET', '/cash/current', { token: owner.token })
    ).json<CurrentCash>().session;
    if (open) {
      await call('POST', `/cash/sessions/${open.id}/close`, {
        token: owner.token,
        payload: { version: open.version, counted: open.expected },
      });
    }
    const cash = (
      await call('POST', '/cash/sessions', {
        token: c,
        payload: { openingFloatCents: 0 },
      })
    ).json<CashSession>();
    expect(cash.openedBy).toBe(cashier.name);
    const blind = (
      await call('GET', '/cash/current', { token: c })
    ).json<CurrentCash>();
    expect(blind.session).toMatchObject({ expected: null, received: null });
    const full = (
      await call('GET', '/cash/current', { token: owner.token })
    ).json<CurrentCash>();
    expect(full.session?.expected).not.toBeNull();
  });

  it('cancelar item enviado pede o PIN do gerente e fica registrado', async () => {
    const waiter = await addUser('waiter', '4444');
    const w = await session(waiter, '4444');
    const category = (
      await call('POST', '/categories', {
        token: owner.token,
        payload: { name: `Aprovação ${randomUUID().slice(0, 6)}` },
      })
    ).json<Category>();
    const product = (
      await call('POST', '/products', {
        token: owner.token,
        payload: { categoryId: category.id, name: 'Suco', priceCents: 900 },
      })
    ).json<Product>();
    const tab = (
      await call('POST', '/tabs', { token: w, payload: {} })
    ).json<TabDetail>();
    const order = (
      await call('POST', '/orders', {
        token: w,
        payload: {
          tabId: tab.id,
          channel: 'counter',
          submit: true,
          items: [{ productId: product.id, quantity: 1 }],
        },
      })
    ).json<Order>();

    const url = `/orders/${order.id}/cancellations`;
    const payload = { reason: 'Cliente desistiu' };
    const ask = await call('POST', url, { token: w, payload });
    expect(ask.statusCode).toBe(403);
    expect(ask.json<ApiError>()).toMatchObject({
      code: 'APPROVAL_REQUIRED',
      details: { action: 'cancelar item já enviado' },
    });
    const wrong = await call('POST', url, {
      token: w,
      payload,
      approval: '9999',
    });
    expect(wrong.json<ApiError>().code).toBe('INVALID_PIN');
    // PIN de garçom não autoriza.
    expect(
      (await call('POST', url, { token: w, payload, approval: '4444' }))
        .statusCode,
    ).toBe(403);

    const ok = await call('POST', url, {
      token: w,
      payload,
      approval: ownerPin,
    });
    expect(ok.statusCode).toBe(201);

    const db = app.get<Database>(DB);
    const { rows } = await db.execute<{
      actor_id: string;
      approver_id: string;
    }>(
      sql`select actor_id, approver_id from audit_events where action = 'order_canceled' and target = ${order.id}`,
    );
    expect(rows[0]).toEqual({
      actor_id: waiter.id,
      approver_id: owner.user.id,
    });
  });

  it('o registro de ações denuncia alteração feita direto no banco', async () => {
    const verify = () =>
      call('GET', '/audit/verify', { token: owner.token }).then((r) =>
        r.json<{ ok: boolean; count: number; brokenAt: number | null }>(),
      );
    expect((await verify()).ok).toBe(true);

    const db = app.get<Database>(DB);
    const { rows } = await db.execute<{ id: number; details: unknown }>(
      sql`select id, details from audit_events where action = 'order_canceled' limit 1`,
    );
    const [row] = rows;
    await db.execute(
      sql`update audit_events set details = '{"reason":"nada aconteceu"}' where id = ${row.id}`,
    );
    expect(await verify()).toMatchObject({ ok: false, brokenAt: row.id });
    // Desfaz para não atrapalhar o resto.
    await db.execute(
      sql`update audit_events set details = ${JSON.stringify(row.details)}::jsonb where id = ${row.id}`,
    );
    expect((await verify()).ok).toBe(true);
  });

  it('protege o último dono e PINs repetidos entre donos', async () => {
    const res = await call('PATCH', `/users/${owner.user.id}`, {
      token: owner.token,
      payload: { version: 1, active: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().code).toBe('LAST_OWNER');

    const dup = await call('POST', '/users', {
      token: owner.token,
      payload: { name: 'Gerente', role: 'owner', pin: ownerPin },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('trocar o PIN ou desativar desconecta os aparelhos da pessoa', async () => {
    const cashier = await addUser('cashier', '5555');
    const token = await session(cashier, '5555');
    expect((await call('GET', '/auth/me', { token })).statusCode).toBe(200);
    await call('PATCH', `/users/${cashier.id}`, {
      token: owner.token,
      payload: { version: cashier.version, active: false },
    });
    expect((await call('GET', '/auth/me', { token })).statusCode).toBe(401);
    expect((await login(cashier.id, '5555')).statusCode).toBe(401);
  });

  it('dono recupera o PIN com o código e sai do aparelho', async () => {
    const wrong = await call('POST', '/auth/recover', {
      payload: {
        userId: owner.user.id,
        recoveryCode: 'AAAA-BBBB-CCCC',
        pin: '8765',
      },
    });
    expect(wrong.statusCode).toBe(401);

    const res = await call('POST', '/auth/recover', {
      // Aceita minúsculas e sem traços.
      payload: {
        userId: owner.user.id,
        recoveryCode: owner.recoveryCode.toLowerCase().replaceAll('-', ''),
        pin: '8765',
      },
    });
    expect(res.statusCode).toBe(200);
    const fresh = res.json<Session>();
    // Sessões antigas do dono caem; o PIN velho não entra mais.
    expect(
      (await call('GET', '/auth/me', { token: owner.token })).statusCode,
    ).toBe(401);
    expect((await login(owner.user.id, ownerPin)).statusCode).toBe(401);
    expect((await login(owner.user.id, '8765')).statusCode).toBe(200);

    const out = await call('POST', '/auth/logout', { token: fresh.token });
    expect(out.statusCode).toBe(204);
    expect(
      (await call('GET', '/auth/me', { token: fresh.token })).statusCode,
    ).toBe(401);
  });
});
