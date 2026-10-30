import type { Network } from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/client.js';
import { DB } from '../src/db/database.module.js';
import { restaurant } from '../src/db/schema.js';
import { createTestApp } from './auth-helper.js';

/** IP dos QR codes e celulares: reserva no roteador e alarme de mudança. */
describe.skipIf(!process.env.DATABASE_URL)('Rede local (e2e)', () => {
  let app: NestFastifyApplication;
  const call = (method: 'GET' | 'PUT', payload?: object) =>
    app.inject({
      method,
      url: `/api/v1/network${method === 'PUT' ? '/published' : ''}`,
      payload,
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('informa endereços e a placa que os celulares usam', async () => {
    const res = await call('GET');
    expect(res.statusCode).toBe(200);
    const net = res.json<Network>();
    for (const a of net.addresses) expect(a).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(net.addresses).not.toContain('127.0.0.1');
    if (net.primary) expect(net.primary.address).toBe(net.addresses[0]);
  });

  it('segue o IP novo quando o roteador troca o desta máquina', async () => {
    const { addresses } = (await call('GET')).json<Network>();
    // Sem placa de rede (ex.: CI isolado) não há o que publicar.
    if (addresses.length === 0) return;
    const [ip] = addresses;

    const reserved = (
      await call('PUT', { address: ip, reserved: true })
    ).json<Network>();
    expect(reserved).toMatchObject({
      publishedAddress: ip,
      addressChanged: false,
      addressReserved: true,
    });
    // Republicar o mesmo IP (ex.: ao imprimir) mantém a reserva confirmada.
    expect(
      (await call('PUT', { address: ip })).json<Network>().addressReserved,
    ).toBe(true);

    // O roteador deu outro IP para a máquina: o publicado ficou para trás.
    const db = app.get<Database>(DB);
    await db
      .update(restaurant)
      .set({ publishedAddress: '10.255.255.254' })
      .where(eq(restaurant.id, 1));

    // O servidor segue o IP novo sozinho e guarda o aviso para o dono.
    const followed = (await call('GET')).json<Network>();
    expect(followed).toMatchObject({
      publishedAddress: ip,
      addressChanged: false,
      // A reserva confirmada era do IP antigo: não vale mais.
      addressReserved: false,
      pendingChange: { from: '10.255.255.254', to: ip, wasReserved: true },
    });

    const seen = await app.inject({
      method: 'DELETE',
      url: '/api/v1/network/pending-change',
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json<Network>().pendingChange).toBeNull();
  });

  it('recusa IP que não é desta máquina', async () => {
    const res = await call('PUT', { address: '10.255.255.254' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await call('PUT', { address: 'abc' })).statusCode).toBe(422);
  });
});
