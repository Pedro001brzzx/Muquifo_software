import {
  type Category,
  errorCodes,
  flavorsText,
  formatCents,
  MAX_PIZZA_FLAVORS,
  type OptionGroup,
  type PizzaFlavor,
  type PizzaTier,
  type Product,
  parseCents,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ClipboardPaste,
  ListPlus,
  Loader2,
  MoreVertical,
  Pencil,
  Pizza,
  Plus,
  Save,
  Search,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { Field, FormDialog } from '@/components/form-dialog';
import { PageBody } from '@/components/layout';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { ruleLabel } from '@/components/option-groups';
import {
  flavorsForSize,
  OptionPicker,
  unitPriceOf,
} from '@/components/option-picker';
import { looksPizza, PizzaKitDialog } from '@/components/pizza-kit';
import { EmptyState } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/errors';
import { cn } from '@/lib/utils';

const NEW_CATEGORY = '__new';
const NO_SECTOR = 'none';
const flavorCounts = Array.from({ length: MAX_PIZZA_FLAVORS }, (_, i) => i + 1);

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

const flavorsLabel = (n: number) => (n === 1 ? '1 sabor' : `até ${n} sabores`);

/** "Calabresa - molho, calabresa" → nome e ingredientes; uma linha por sabor. */
const parsePastedFlavors = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/\s*[-–:]\s+|\s*[–:]\s*/);
      return { name: name.trim(), description: rest.join(', ').trim() || null };
    })
    .filter((f) => f.name);

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly string[])[]) => {
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
}

/**
 * Pizzaria: tamanhos (produtos com limite de sabores), tabela de preço por
 * faixa e tamanho, sabores e bordas, com teste da tela do garçom.
 */
export function PizzeriaPage() {
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const products = useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
  });
  const tiers = useQuery({
    queryKey: [...queryKeys.pizzaTiers, 'all'],
    queryFn: () => api.pizzaTiers({ status: 'all' }),
  });
  const flavors = useQuery({
    queryKey: [...queryKeys.pizzaFlavors, 'all'],
    queryFn: () => api.pizzaFlavors({ status: 'all' }),
  });
  const [kitOpen, setKitOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const sizes = useMemo(
    () =>
      (products.data ?? [])
        .filter((p) => p.active && p.maxFlavors !== null)
        .sort(
          (a, b) =>
            (a.maxFlavors ?? 0) - (b.maxFlavors ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [products.data],
  );
  // Categoria das pizzas: a dos tamanhos existentes ou uma com "pizza" no nome.
  const pizzaCategory =
    categories.data?.find((c) => c.id === sizes[0]?.categoryId) ??
    categories.data?.find((c) => c.active && looksPizza(c.name));

  const loading =
    categories.isLoading ||
    products.isLoading ||
    tiers.isLoading ||
    flavors.isLoading;
  const empty = sizes.length === 0 && (tiers.data ?? []).length === 0;

  return (
    <>
      <div className="border-b bg-background px-4 py-5 md:px-8 md:py-6">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link to="/produtos">
            <ArrowLeft /> Produtos
          </Link>
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Pizza className="size-6 text-primary" /> Pizzaria
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Tamanhos, faixas de preço e sabores. Pizza com mais de um sabor
              cobra o da faixa mais cara. Tudo aparece para o garçom na hora.
            </p>
          </div>
          {!empty && (
            <Button variant="outline" onClick={() => setKitOpen(true)}>
              <Sparkles /> Modelo de pizzaria
            </Button>
          )}
        </div>
      </div>

      <PageBody className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : empty && !started ? (
          <EmptyState
            icon={Pizza}
            title="Monte a pizzaria em um minuto"
            description="O modelo cria os tamanhos P (1 sabor), M (2) e G (3), as faixas Tradicional, Especial e Doce com preços sugeridos, 16 sabores e a borda recheada."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setKitOpen(true)}>
                  <Sparkles /> Usar modelo de pizzaria
                </Button>
                <Button variant="outline" onClick={() => setStarted(true)}>
                  Começar do zero
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="space-y-6">
              <SizesCard sizes={sizes} pizzaCategory={pizzaCategory} />
              <PriceGridCard sizes={sizes} tiers={tiers.data ?? []} />
              <FlavorsCard
                tiers={(tiers.data ?? []).filter((t) => t.active)}
                flavors={flavors.data ?? []}
              />
            </div>
            <div className="space-y-6 xl:sticky xl:top-4">
              <PreviewCard
                sizes={sizes}
                tiers={tiers.data ?? []}
                flavors={flavors.data ?? []}
              />
              <BordaCard category={pizzaCategory} />
            </div>
          </div>
        )}
      </PageBody>

      <PizzaKitDialog open={kitOpen} onClose={() => setKitOpen(false)} />
    </>
  );
}

// ---------- 1. Tamanhos ----------

function SizesCard({
  sizes,
  pizzaCategory,
}: {
  sizes: Product[];
  pizzaCategory?: Category;
}) {
  const invalidate = useInvalidate();
  const sectors = useQuery({
    queryKey: queryKeys.sectors,
    queryFn: api.sectors,
  });
  const [name, setName] = useState('');
  const [maxFlavors, setMaxFlavors] = useState('2');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // Setor das pizzas novas: o dos tamanhos existentes, ou pizzaria/forno/cozinha.
  const sectorId =
    sizes[0]?.sectorId ??
    (
      sectors.data?.find((s) => /pizza|forno/i.test(s.name)) ??
      sectors.data?.find((s) => /cozinha/i.test(s.name))
    )?.id ??
    null;

  const create = useMutation({
    mutationFn: async () => {
      const category =
        pizzaCategory ?? (await api.createCategory({ name: 'Pizzas' }));
      return api.createProduct({
        categoryId: category.id,
        sectorId,
        name: name.trim(),
        priceCents: 0,
        maxFlavors: Number(maxFlavors),
      });
    },
    onSuccess: (p) => {
      toast.success(`${p.name} criada`, {
        description: 'Preencha o preço dela na tabela de faixas.',
      });
      setName('');
      nameRef.current?.focus();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === errorCodes.conflict)
        return setError(e.message);
      toastError(e);
    },
    onSettled: () => invalidate(queryKeys.products, queryKeys.categories),
  });

  const update = useMutation({
    mutationFn: ({
      product,
      changes,
    }: {
      product: Product;
      changes: { name?: string; maxFlavors?: number; active?: boolean };
    }) =>
      api.updateProduct(product.id, { version: product.version, ...changes }),
    onSuccess: (p, { changes }) => {
      if (changes.active === false) {
        toast.success(`${p.name} saiu do cardápio`, {
          action: {
            label: 'Desfazer',
            onClick: () =>
              update.mutate({ product: p, changes: { active: true } }),
          },
        });
      }
    },
    onError: toastError,
    onSettled: () => invalidate(queryKeys.products),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Dê um nome ao tamanho.');
    setError('');
    create.mutate();
  }

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>1. Tamanhos</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cada tamanho vira um item no cardápio
          {pizzaCategory ? ` (categoria ${pizzaCategory.name})` : ''}, com o
          número de sabores que aceita.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sizes.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {sizes.map((p) => (
              <li
                key={`${p.id}-${p.version}`}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <Input
                  defaultValue={p.name}
                  aria-label="Nome do tamanho"
                  maxLength={120}
                  className="h-9 min-w-40 flex-1 font-medium"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name)
                      update.mutate({ product: p, changes: { name: v } });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <Select
                  value={String(p.maxFlavors)}
                  onValueChange={(v) =>
                    update.mutate({
                      product: p,
                      changes: { maxFlavors: Number(v) },
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {flavorCounts.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {flavorsLabel(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!p.available && <Badge variant="secondary">Esgotada</Badge>}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Tirar ${p.name} do cardápio`}
                  onClick={() =>
                    update.mutate({ product: p, changes: { active: false } })
                  }
                >
                  <Archive />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Input
              ref={nameRef}
              placeholder={
                sizes.length
                  ? 'Novo tamanho (ex.: Pizza Gigante)'
                  : 'Ex.: Pizza Grande'
              }
              maxLength={120}
              className="min-w-40 flex-1"
              value={name}
              aria-invalid={!!error || undefined}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
            />
            <Select value={maxFlavors} onValueChange={setMaxFlavors}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {flavorCounts.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {flavorsLabel(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline" disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus />
              )}
              Adicionar
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!pizzaCategory && (
            <p className="text-xs text-muted-foreground">
              A categoria “Pizzas” será criada junto com o primeiro tamanho.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------- 2. Faixas e preços ----------

type Edits = Record<string, { name?: string; prices: Record<string, string> }>;

function PriceGridCard({
  sizes,
  tiers,
}: {
  sizes: Product[];
  tiers: PizzaTier[];
}) {
  const invalidate = useInvalidate();
  const [edits, setEdits] = useState<Edits>({});
  const [newTier, setNewTier] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const active = tiers.filter((t) => t.active);
  const archived = tiers.filter((t) => !t.active);
  const dirty = Object.keys(edits);

  const cellText = (t: PizzaTier, productId: string) => {
    const edit = edits[t.id]?.prices[productId];
    if (edit !== undefined) return edit;
    const price = t.prices.find((p) => p.productId === productId);
    return price ? centsToInput(price.priceCents) : '';
  };
  const setCell = (tierId: string, productId: string, text: string) =>
    setEdits((e) => ({
      ...e,
      [tierId]: {
        ...e[tierId],
        prices: { ...e[tierId]?.prices, [productId]: text },
      },
    }));

  const save = useMutation({
    mutationFn: async () => {
      for (const tierId of dirty) {
        const tier = tiers.find((t) => t.id === tierId);
        if (!tier) continue;
        const edit = edits[tierId];
        // Tamanhos fora da tela (arquivados) mantêm o preço que tinham.
        const kept = tier.prices.filter(
          (p) => !sizes.some((s) => s.id === p.productId),
        );
        const prices = sizes.flatMap((s) => {
          const text = cellText(tier, s.id).trim();
          if (!text) return [];
          const cents = parseCents(text);
          if (cents === null)
            throw new Error(`Preço inválido em ${tier.name} · ${s.name}.`);
          return [{ productId: s.id, priceCents: cents }];
        });
        await api.updatePizzaTier(tierId, {
          name: edit.name?.trim() || undefined,
          prices: [...kept, ...prices],
        });
      }
    },
    onSuccess: () => {
      toast.success('Preços salvos', {
        description: 'O garçom já vê os valores novos.',
      });
      setEdits({});
    },
    onError: toastError,
    onSettled: () => invalidate(queryKeys.pizzaTiers),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createPizzaTier({ name: newTier.trim(), sortOrder: tiers.length }),
    onSuccess: (t) => {
      toast.success(`Faixa ${t.name} criada`, {
        description: 'Preencha o preço em cada tamanho.',
      });
      setNewTier('');
    },
    onError: toastError,
    onSettled: () => invalidate(queryKeys.pizzaTiers),
  });

  const toggle = useMutation({
    mutationFn: (t: PizzaTier) =>
      api.updatePizzaTier(t.id, { active: !t.active }),
    onSuccess: (t) =>
      toast.success(
        t.active ? `Faixa ${t.name} restaurada` : `Faixa ${t.name} arquivada`,
      ),
    onError: toastError,
    onSettled: () => invalidate(queryKeys.pizzaTiers),
  });

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>2. Faixas e preços</CardTitle>
        <p className="text-sm text-muted-foreground">
          O preço da pizza vem da faixa do sabor. Deixe a célula vazia para a
          faixa não sair naquele tamanho.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sizes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Cadastre os tamanhos primeiro; cada um vira uma coluna aqui.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Faixa</th>
                  {sizes.map((s) => (
                    <th
                      key={s.id}
                      className="px-2 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {s.name}
                      <span className="block font-normal">
                        {flavorsLabel(s.maxFlavors ?? 1)}
                      </span>
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {active.map((t) => (
                  <tr key={t.id} className={cn(edits[t.id] && 'bg-primary/5')}>
                    <td className="px-3 py-2">
                      <Input
                        aria-label="Nome da faixa"
                        className="h-9 w-36 font-medium"
                        maxLength={60}
                        value={edits[t.id]?.name ?? t.name}
                        onChange={(e) =>
                          setEdits((x) => ({
                            ...x,
                            [t.id]: {
                              prices: x[t.id]?.prices ?? {},
                              name: e.target.value,
                            },
                          }))
                        }
                      />
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t.flavorCount}{' '}
                        {t.flavorCount === 1 ? 'sabor' : 'sabores'}
                      </span>
                    </td>
                    {sizes.map((s) => (
                      <td key={s.id} className="px-2 py-2 align-top">
                        <MoneyInput
                          id={`price-${t.id}-${s.id}`}
                          className="h-9 w-32 text-sm font-medium md:text-sm"
                          placeholder="não vende"
                          value={cellText(t, s.id)}
                          onChange={(v) => setCell(t.id, s.id, v)}
                        />
                      </td>
                    ))}
                    <td className="px-1 py-2 align-top">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Ações da faixa ${t.name}`}
                          >
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={t.flavorCount > 0}
                            onSelect={() => toggle.mutate(t)}
                          >
                            <Archive />
                            {t.flavorCount > 0
                              ? 'Arquivar (mova os sabores antes)'
                              : 'Arquivar'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newTier.trim()) create.mutate();
            }}
          >
            <Input
              placeholder="Nova faixa (ex.: Premium)"
              maxLength={60}
              className="max-w-64"
              value={newTier}
              onChange={(e) => setNewTier(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!newTier.trim() || create.isPending}
            >
              <Plus /> Faixa
            </Button>
          </form>
          <div className="flex gap-2">
            {dirty.length > 0 && (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => setEdits({})}
              >
                Descartar
              </Button>
            )}
            <Button
              disabled={dirty.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar preços
            </Button>
          </div>
        </div>

        {archived.length > 0 && (
          <div className="text-sm">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? 'Ocultar' : 'Ver'} {archived.length} faixa(s)
              arquivada(s)
            </button>
            {showArchived && (
              <ul className="mt-2 divide-y rounded-lg border">
                {archived.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between px-3 py-2 text-muted-foreground"
                  >
                    {t.name}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle.mutate(t)}
                    >
                      <ArchiveRestore /> Restaurar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- 3. Sabores ----------

function FlavorsCard({
  tiers,
  flavors,
}: {
  tiers: PizzaTier[];
  flavors: PizzaFlavor[];
}) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tierId, setTierId] = useState('');
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<PizzaFlavor | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0];
  const parsed = parsePastedFlavors(pasteText);

  const create = useMutation({
    mutationFn: () =>
      api.createPizzaFlavor({
        tierId: tier!.id,
        name: name.trim(),
        description: description.trim() || null,
        sortOrder: flavors.filter((f) => f.tierId === tier!.id).length,
      }),
    onSuccess: (f) => {
      toast.success(`${f.name} no cardápio`);
      setName('');
      setDescription('');
      nameRef.current?.focus();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === errorCodes.conflict)
        return setError(e.message);
      toastError(e);
    },
    onSettled: () => invalidate(queryKeys.pizzaFlavors, queryKeys.pizzaTiers),
  });

  const paste = useMutation({
    mutationFn: async () => {
      let created = 0;
      const skipped: string[] = [];
      for (const [i, f] of parsed.entries()) {
        if (flavors.some((x) => normalize(x.name) === normalize(f.name))) {
          skipped.push(f.name);
          continue;
        }
        await api.createPizzaFlavor({
          tierId: tier!.id,
          ...f,
          sortOrder: flavors.length + i,
        });
        created++;
      }
      return { created, skipped };
    },
    onSuccess: ({ created, skipped }) => {
      toast.success(`${created} sabor(es) em ${tier?.name}`, {
        description: skipped.length
          ? `Já existiam: ${skipped.join(', ')}`
          : undefined,
      });
      setPasteText('');
      setPasting(false);
    },
    onError: toastError,
    onSettled: () => invalidate(queryKeys.pizzaFlavors, queryKeys.pizzaTiers),
  });

  const update = useMutation({
    mutationFn: ({
      flavor,
      changes,
    }: {
      flavor: PizzaFlavor;
      changes: Parameters<typeof api.updatePizzaFlavor>[1];
    }) => api.updatePizzaFlavor(flavor.id, changes),
    onSuccess: (f, { changes }) => {
      if (changes.active !== undefined)
        toast.success(
          f.active ? `${f.name} de volta ao cardápio` : `${f.name} arquivado`,
        );
      setEditing(null);
    },
    onError: toastError,
    onSettled: () => invalidate(queryKeys.pizzaFlavors, queryKeys.pizzaTiers),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Dê um nome ao sabor.');
    setError('');
    create.mutate();
  }

  const term = normalize(search);
  const visible = flavors.filter(
    (f) =>
      f.active !== showArchived &&
      (!term ||
        normalize(f.name).includes(term) ||
        normalize(f.description ?? '').includes(term)),
  );
  const archivedCount = flavors.filter((f) => !f.active).length;
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>3. Sabores</CardTitle>
        <p className="text-sm text-muted-foreground">
          Digite o nome e os ingredientes e tecle Enter. Os ingredientes
          aparecem para o garçom e na busca.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {tiers.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Crie uma faixa de preço primeiro (ex.: Tradicional).
          </p>
        ) : (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Faixa</span>
              <div className="flex flex-wrap gap-1.5">
                {tiers.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant={tier?.id === t.id ? 'default' : 'outline'}
                    className="rounded-full"
                    onClick={() => setTierId(t.id)}
                  >
                    {t.name}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setPasting((v) => !v)}
              >
                <ClipboardPaste /> {pasting ? 'Um por um' : 'Colar vários'}
              </Button>
            </div>
            {pasting ? (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  rows={5}
                  placeholder={
                    'Um sabor por linha, ingredientes depois do traço:\nCalabresa - molho, mussarela, calabresa, cebola\nPortuguesa - presunto, ovo, cebola, azeitona'
                  }
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {parsed.length} sabor(es) para {tier?.name}
                  </span>
                  <Button
                    size="sm"
                    disabled={parsed.length === 0 || paste.isPending}
                    onClick={() => paste.mutate()}
                  >
                    {paste.isPending && <Loader2 className="animate-spin" />}
                    Adicionar {parsed.length || ''}
                  </Button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={submit}
                className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
              >
                <Input
                  ref={nameRef}
                  placeholder="Sabor (ex.: Calabresa)"
                  maxLength={60}
                  value={name}
                  aria-invalid={!!error || undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                  }}
                />
                <Input
                  placeholder="Ingredientes (opcional)"
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                  Adicionar
                </Button>
                {error && (
                  <p className="text-xs text-destructive sm:col-span-3">
                    {error}
                  </p>
                )}
              </form>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar sabor ou ingrediente"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {archivedCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              Arquivados ({archivedCount})
            </label>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {flavors.length === 0
              ? 'Nenhum sabor ainda.'
              : 'Nenhum sabor encontrado.'}
          </p>
        ) : (
          [...tiers.map((t) => t.id), null].map((tid) => {
            // Sabores de faixa arquivada aparecem no fim, para serem movidos.
            const list = visible.filter((f) =>
              tid ? f.tierId === tid : !tierName.has(f.tierId),
            );
            if (list.length === 0) return null;
            return (
              <section key={tid ?? 'other'} className="space-y-1.5">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {tid ? tierName.get(tid) : 'Faixa arquivada'} · {list.length}
                </h3>
                <ul className="divide-y rounded-lg border">
                  {list.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setEditing(f)}
                      >
                        <span
                          className={cn(
                            'block truncate text-sm font-medium',
                            (!f.available || !f.active) &&
                              'text-muted-foreground',
                          )}
                        >
                          {f.name}
                        </span>
                        {f.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {f.description}
                          </span>
                        )}
                      </button>
                      {f.active && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="hidden sm:inline">
                            {f.available ? 'Disponível' : 'Em falta'}
                          </span>
                          <Switch
                            checked={f.available}
                            aria-label={`${f.name} disponível`}
                            onCheckedChange={(available) =>
                              update.mutate({
                                flavor: f,
                                changes: { available },
                              })
                            }
                          />
                        </label>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Ações de ${f.name}`}
                          >
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(f)}>
                            <Pencil /> Editar
                          </DropdownMenuItem>
                          {f.active ? (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                update.mutate({
                                  flavor: f,
                                  changes: { active: false },
                                })
                              }
                            >
                              <Archive /> Arquivar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() =>
                                update.mutate({
                                  flavor: f,
                                  changes: { active: true },
                                })
                              }
                            >
                              <ArchiveRestore /> Restaurar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

        <FlavorDialog
          flavor={editing}
          tiers={tiers}
          pending={update.isPending}
          onClose={() => setEditing(null)}
          onSave={(changes) =>
            editing && update.mutate({ flavor: editing, changes })
          }
        />
      </CardContent>
    </Card>
  );
}

function FlavorDialog({
  flavor,
  tiers,
  pending,
  onClose,
  onSave,
}: {
  flavor: PizzaFlavor | null;
  tiers: PizzaTier[];
  pending: boolean;
  onClose: () => void;
  onSave: (changes: {
    name: string;
    description: string | null;
    tierId: string;
  }) => void;
}) {
  const [tierId, setTierId] = useState('');
  const current = tierId || flavor?.tierId || '';
  return (
    <FormDialog
      key={flavor?.id}
      open={!!flavor}
      onClose={() => {
        setTierId('');
        onClose();
      }}
      title={`Editar ${flavor?.name ?? ''}`}
      pending={pending}
      onSubmit={(data) => {
        const name = String(data.get('name') ?? '').trim();
        if (!name) return;
        onSave({
          name,
          description: String(data.get('description') ?? '').trim() || null,
          tierId: current,
        });
        setTierId('');
      }}
    >
      <Field label="Sabor" htmlFor="f-name">
        <Input
          id="f-name"
          name="name"
          maxLength={60}
          defaultValue={flavor?.name}
        />
      </Field>
      <Field label="Ingredientes" htmlFor="f-desc">
        <Textarea
          id="f-desc"
          name="description"
          rows={3}
          maxLength={300}
          defaultValue={flavor?.description ?? ''}
        />
      </Field>
      <Field label="Faixa de preço">
        <Select value={current} onValueChange={setTierId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {tiers.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </FormDialog>
  );
}

// ---------- Prévia e bordas ----------

function PreviewCard({
  sizes,
  tiers,
  flavors,
}: {
  sizes: Product[];
  tiers: PizzaTier[];
  flavors: PizzaFlavor[];
}) {
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const groups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
  });
  const [testing, setTesting] = useState<Product | null>(null);
  const menu = { tiers, flavors };

  /** Grupos do tamanho: os da categoria (menos os desligados) e os dele. */
  const groupsFor = (p: Product): OptionGroup[] => {
    const byId = new Map(groups.data?.map((g) => [g.id, g]));
    const fromCategory = (
      categories.data?.find((c) => c.id === p.categoryId)?.optionGroupIds ?? []
    ).filter((id) => !p.excludedOptionGroupIds.includes(id));
    return [...new Set([...fromCategory, ...p.optionGroupIds])]
      .map((id) => byId.get(id))
      .filter((g): g is OptionGroup => !!g);
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" /> Como o garçom vê
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sizes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Os tamanhos aparecem aqui como botões do cardápio.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sizes.map((s) => {
              const prices = flavorsForSize(menu, s.id).map(
                (t) => t.priceCents,
              );
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTesting(s)}
                  className="flex min-h-20 flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-accent/50"
                >
                  <span className="text-sm leading-snug font-medium">
                    {s.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular">
                    {prices.length ? (
                      <>
                        {formatCents(s.priceCents + Math.min(...prices))}
                        {Math.max(...prices) !== Math.min(...prices) &&
                          ` a ${formatCents(s.priceCents + Math.max(...prices))}`}
                      </>
                    ) : (
                      <span className="text-busy">sem preço</span>
                    )}
                    <span className="block">
                      {flavorsLabel(s.maxFlavors ?? 1)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {sizes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Toque num tamanho para testar a escolha de sabores. Nada é lançado.
          </p>
        )}
      </CardContent>
      <OptionPicker
        product={testing}
        groups={testing ? groupsFor(testing) : []}
        allGroups={groups.data ?? []}
        pizza={menu}
        confirmLabel="Simular"
        onClose={() => setTesting(null)}
        onConfirm={(r) => {
          if (!testing) return;
          const unit = unitPriceOf(testing, r);
          toast.info(`${testing.name} · ${formatCents(unit * r.quantity)}`, {
            description: [
              flavorsText(r.flavors),
              r.options.map((o) => o.name).join(', '),
            ]
              .filter(Boolean)
              .join(' · '),
          });
          setTesting(null);
        }}
      />
    </Card>
  );
}

const bordaPreset = {
  name: 'Borda recheada',
  minSelect: 0,
  maxSelect: 1,
  options: [
    { name: 'Catupiry', priceCents: 1000 },
    { name: 'Cheddar', priceCents: 1000 },
    { name: 'Chocolate', priceCents: 1200 },
  ],
};

function BordaCard({ category }: { category?: Category }) {
  const invalidate = useInvalidate();
  const groups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
  });
  const linked = (category?.optionGroupIds ?? [])
    .map((id) => groups.data?.find((g) => g.id === id))
    .filter((g): g is OptionGroup => !!g);

  const addBorda = useMutation({
    mutationFn: async () => {
      const all = await api.optionGroups({ status: 'all' });
      const group =
        all.find((g) => normalize(g.name) === normalize(bordaPreset.name)) ??
        (await api.createOptionGroup(bordaPreset));
      await api.updateCategory(category!.id, {
        optionGroupIds: [...category!.optionGroupIds, group.id],
      });
      return group;
    },
    onSuccess: (g) =>
      toast.success(`${g.name} ligada a todas as pizzas`, {
        description: 'Ajuste os preços em Produtos › Complementos.',
      }),
    onError: toastError,
    onSettled: () => invalidate(queryKeys.optionGroups, queryKeys.categories),
  });

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListPlus className="size-4" /> Bordas e extras
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Complementos ligados à categoria valem para todos os tamanhos.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!category ? (
          <p className="text-sm text-muted-foreground">
            Disponível depois do primeiro tamanho.
          </p>
        ) : (
          <>
            {linked.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum complemento nas pizzas.
              </p>
            ) : (
              <ul className="space-y-2">
                {linked.map((g) => (
                  <li key={g.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{g.name}</span>
                      <Badge variant="secondary">{ruleLabel(g)}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {g.options
                        .map(
                          (o) =>
                            o.name +
                            (o.priceCents
                              ? ` +${formatCents(o.priceCents)}`
                              : ''),
                        )
                        .join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {!linked.some((g) => /borda/i.test(g.name)) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={addBorda.isPending}
                  onClick={() => addBorda.mutate()}
                >
                  {addBorda.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                  Borda recheada
                </Button>
              )}
              <Button size="sm" variant="ghost" asChild>
                <Link to="/produtos?aba=complementos">
                  Gerenciar complementos
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
