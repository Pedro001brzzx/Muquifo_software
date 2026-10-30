import { randomUUID } from 'node:crypto';
import type {
  Category,
  OptionGroup,
  Product,
  PublicMenu,
  Restaurant,
} from '@muquifo/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './auth-helper.js';

/** Cardápio público do QR code: só itens ativos, sem campos internos. */
describe.skipIf(!process.env.DATABASE_URL)('Cardápio público (e2e)', () => {
  let app: NestFastifyApplication;
  const tag = () => randomUUID().slice(0, 8);
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
  ) => app.inject({ method, url: `/api/v1${url}`, payload });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('mostra extras efetivos, esgotados marcados e esconde arquivados', async () => {
    const adicionais = (
      await call('POST', '/option-groups', {
        name: `Adicionais ${tag()}`,
        maxSelect: 3,
        options: [
          { name: 'Bacon', priceCents: 400 },
          { name: 'Ovo', priceCents: 200, available: false },
        ],
      })
    ).json<OptionGroup>();
    const ponto = (
      await call('POST', '/option-groups', {
        name: `Ponto ${tag()}`,
        minSelect: 1,
        options: [{ name: 'Ao ponto' }],
      })
    ).json<OptionGroup>();
    const category = (
      await call('POST', '/categories', {
        name: `Lanches ${tag()}`,
        optionGroupIds: [adicionais.id],
      })
    ).json<Category>();
    const product = (name: string, extra: object = {}) =>
      call('POST', '/products', {
        categoryId: category.id,
        name: `${name} ${tag()}`,
        priceCents: 2500,
        ...extra,
      }).then((r) => r.json<Product>());

    const burger = await product('X-Burger', {
      icon: '🍔',
      optionGroupIds: [ponto.id],
    });
    const frango = await product('X-Frango', {
      excludedOptionGroupIds: [adicionais.id],
      available: false,
    });
    const old = await product('Antigo');
    await call('PATCH', `/products/${old.id}`, {
      version: old.version,
      active: false,
    });

    const res = await call('GET', '/menu');
    expect(res.statusCode).toBe(200);
    const menu = res.json<PublicMenu>();
    const section = menu.categories.find((c) => c.id === category.id)!;
    expect(section.items.map((i) => i.id).sort()).toEqual(
      [burger.id, frango.id].sort(),
    );

    const b = section.items.find((i) => i.id === burger.id)!;
    expect(b.icon).toBe('🍔');
    expect(b.extras).toEqual([
      {
        name: adicionais.name,
        required: false,
        // Opção em falta não aparece para o cliente.
        options: [{ name: 'Bacon', priceCents: 400 }],
      },
      {
        name: ponto.name,
        required: true,
        options: [{ name: 'Ao ponto', priceCents: 0 }],
      },
    ]);
    // Sem campos internos.
    expect(b).not.toHaveProperty('sectorId');
    expect(b).not.toHaveProperty('version');

    const f = section.items.find((i) => i.id === frango.id)!;
    expect(f.available).toBe(false);
    expect(f.extras).toEqual([]);
  });

  it('mostra nome, frase e aviso do restaurante no topo', async () => {
    const before = (await call('GET', '/restaurant')).json<Restaurant>();
    const name = `Lanchonete ${tag()}`;
    const saved = await call('PATCH', '/restaurant', {
      version: before.version,
      name,
      tagline: '  Desde 1998 ',
      notice: '',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<Restaurant>()).toEqual({
      name,
      tagline: 'Desde 1998',
      notice: null,
      version: before.version + 1,
    });

    const menu = (await call('GET', '/menu')).json<PublicMenu>();
    expect(menu.restaurant).toEqual({
      name,
      tagline: 'Desde 1998',
      notice: null,
    });

    // Versão antiga: outra pessoa já alterou.
    const stale = await call('PATCH', '/restaurant', {
      version: before.version,
      name: 'Outro',
      tagline: null,
      notice: null,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
