import { formatCents, type Product, parseCents } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { API_URL, ApiRequestError, api } from './api';

export function App() {
  const [tab, setTab] = useState<'catalog' | 'tables'>('catalog');
  return (
    <div className="app">
      <header className="topbar">
        <strong>Muquifo · console de testes</strong>
        <nav>
          <button
            aria-pressed={tab === 'catalog'}
            onClick={() => setTab('catalog')}
          >
            Cardápio
          </button>
          <button
            aria-pressed={tab === 'tables'}
            onClick={() => setTab('tables')}
          >
            Mesas
          </button>
        </nav>
        <ConnectionStatus />
      </header>
      <main>{tab === 'catalog' ? <CatalogPage /> : <TablesPage />}</main>
    </div>
  );
}

function ConnectionStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 5_000,
    retry: false,
  });
  const state = health.isError
    ? { cls: 'bad', text: 'Servidor inacessível' }
    : health.data?.database === 'down'
      ? { cls: 'warn', text: 'Servidor sem banco' }
      : health.data
        ? { cls: 'ok', text: `Servidor conectado · v${health.data.version}` }
        : { cls: 'warn', text: 'Conectando…' };
  return (
    <span className={`status ${state.cls}`} title={API_URL} role="status">
      {state.text}
    </span>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiRequestError ? error : null;
  return (
    <div className="error" role="alert">
      <strong>{e?.body?.code ?? 'ERRO'}</strong>{' '}
      {error instanceof Error ? error.message : String(error)}
      {e?.body?.details !== undefined && (
        <pre>{JSON.stringify(e.body.details, null, 2)}</pre>
      )}
      {e?.body?.requestId && <small>requestId: {e.body.requestId}</small>}
    </div>
  );
}

function CatalogPage() {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
  });
  const sectors = useQuery({ queryKey: ['sectors'], queryFn: api.sectors });
  const products = useQuery({ queryKey: ['products'], queryFn: api.products });

  const createCategory = useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const createProduct = useMutation({
    mutationFn: api.createProduct,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
  const toggle = useMutation({
    mutationFn: (p: Product) =>
      api.setAvailability(p.id, {
        available: !p.available,
        version: p.version,
      }),
    // Em conflito de versão também recarrega, para o usuário ver o estado atual.
    onSettled: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const [priceError, setPriceError] = useState<string | null>(null);

  function onCreateCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    createCategory.mutate(
      {
        name: String(data.get('name')),
        sortOrder: Number(data.get('sortOrder') || 0),
      },
      { onSuccess: () => form.reset() },
    );
  }

  function onCreateProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const priceCents = parseCents(String(data.get('price')));
    if (priceCents === null) {
      setPriceError('Preço inválido. Use o formato 12,50.');
      return;
    }
    setPriceError(null);
    createProduct.mutate(
      {
        categoryId: String(data.get('categoryId')),
        sectorId: String(data.get('sectorId')) || null,
        name: String(data.get('name')),
        priceCents,
      },
      { onSuccess: () => form.reset() },
    );
  }

  const byCategory = new Map<string, Product[]>();
  for (const p of products.data ?? []) {
    byCategory.set(p.categoryId, [...(byCategory.get(p.categoryId) ?? []), p]);
  }
  const sectorName = new Map(sectors.data?.map((s) => [s.id, s.name]));

  return (
    <div className="grid">
      <section className="card">
        <h2>Nova categoria</h2>
        <form onSubmit={onCreateCategory}>
          <label>
            Nome <input name="name" required maxLength={120} />
          </label>
          <label>
            Ordem{' '}
            <input name="sortOrder" type="number" min={0} defaultValue={0} />
          </label>
          <button disabled={createCategory.isPending}>Criar categoria</button>
          <ErrorBox error={createCategory.error} />
        </form>

        <h2>Novo produto</h2>
        <form onSubmit={onCreateProduct}>
          <label>
            Nome <input name="name" required maxLength={120} />
          </label>
          <label>
            Preço (R$){' '}
            <input
              name="price"
              required
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
          <label>
            Categoria
            <select name="categoryId" required>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Setor de produção
            <select name="sectorId" defaultValue="">
              <option value="">— nenhum —</option>
              {sectors.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={createProduct.isPending}>Criar produto</button>
          {priceError && <div className="error">{priceError}</div>}
          <ErrorBox error={createProduct.error} />
        </form>
      </section>

      <section className="card wide">
        <h2>Cardápio</h2>
        {products.isLoading && <p>Carregando…</p>}
        <ErrorBox error={products.error ?? categories.error} />
        <ErrorBox error={toggle.error} />
        {categories.data?.length === 0 && (
          <p className="muted">Nenhuma categoria. Rode o seed ou crie uma.</p>
        )}
        {categories.data?.map((c) => (
          <div key={c.id}>
            <h3>{c.name}</h3>
            {(byCategory.get(c.id) ?? []).length === 0 && (
              <p className="muted">Sem produtos.</p>
            )}
            <ul className="products">
              {byCategory.get(c.id)?.map((p) => (
                <li key={p.id} className={p.available ? '' : 'unavailable'}>
                  <span>
                    {p.name}
                    <small className="muted">
                      {' '}
                      · {p.sectorId ? sectorName.get(p.sectorId) : 'sem setor'}{' '}
                      · v{p.version}
                    </small>
                  </span>
                  <span className="price">{formatCents(p.priceCents)}</span>
                  <button
                    disabled={toggle.isPending && toggle.variables?.id === p.id}
                    onClick={() => toggle.mutate(p)}
                  >
                    {p.available ? 'Pausar' : 'Disponibilizar'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

const statusLabel = {
  free: 'Livre',
  occupied: 'Ocupada',
  closing: 'Em fechamento',
} as const;

function TablesPage() {
  const qc = useQueryClient();
  const tables = useQuery({ queryKey: ['tables'], queryFn: api.tables });
  const create = useMutation({
    mutationFn: api.createTable,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    create.mutate(
      {
        number: Number(data.get('number')),
        label: String(data.get('label')) || null,
        seats: data.get('seats') ? Number(data.get('seats')) : null,
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>Nova mesa</h2>
        <form onSubmit={onSubmit}>
          <label>
            Número <input name="number" type="number" min={1} required />
          </label>
          <label>
            Rótulo <input name="label" maxLength={60} placeholder="Varanda" />
          </label>
          <label>
            Lugares <input name="seats" type="number" min={1} />
          </label>
          <button disabled={create.isPending}>Criar mesa</button>
          <ErrorBox error={create.error} />
        </form>
      </section>
      <section className="card wide">
        <h2>Mesas</h2>
        {tables.isLoading && <p>Carregando…</p>}
        <ErrorBox error={tables.error} />
        {tables.data?.length === 0 && (
          <p className="muted">Nenhuma mesa cadastrada.</p>
        )}
        <div className="tables">
          {tables.data?.map((t) => (
            <div key={t.id} className={`table ${t.status}`}>
              <strong>{String(t.number).padStart(2, '0')}</strong>
              <span>{statusLabel[t.status]}</span>
              {t.label && <small>{t.label}</small>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
