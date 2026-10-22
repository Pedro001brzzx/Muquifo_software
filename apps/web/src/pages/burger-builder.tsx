import {
  errorCodes,
  formatCents,
  type Ingredient,
  type OptionGroup,
  type Product,
  parseCents,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChefHat,
  Copy,
  ListPlus,
  Loader2,
  Plus,
  Save,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { Field } from '@/components/form-dialog';
import { PageBody } from '@/components/layout';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { GroupPicker, ruleLabel } from '@/components/option-groups';
import { adjustmentsText, OptionPicker } from '@/components/option-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const NO_SECTOR = 'none';
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

interface RecipeLine {
  ingredientId: string;
  name: string;
  adjustable: boolean;
}

interface BuilderState {
  name: string;
  priceText: string;
  code: string;
  description: string;
  categoryId: string;
  sectorId: string;
  recipe: RecipeLine[];
  optionGroupIds: string[];
  excludedOptionGroupIds: string[];
}

const emptyState = (categoryId = '', sectorId = NO_SECTOR): BuilderState => ({
  name: '',
  priceText: '',
  code: '',
  description: '',
  categoryId,
  sectorId,
  recipe: [],
  optionGroupIds: [],
  excludedOptionGroupIds: [],
});

const fromProduct = (p: Product): BuilderState => ({
  name: p.name,
  priceText: centsToInput(p.priceCents),
  code: p.code ?? '',
  description: p.description ?? '',
  categoryId: p.categoryId,
  sectorId: p.sectorId ?? NO_SECTOR,
  recipe: p.ingredients.map((i) => ({ ...i })),
  optionGroupIds: p.optionGroupIds,
  excludedOptionGroupIds: p.excludedOptionGroupIds,
});

/**
 * Montador de lanche: nome, preço, ingredientes da biblioteca e complementos,
 * com prévia do que o garçom vê. Salvo, aparece no cardápio na hora.
 */
export function BurgerBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const sectors = useQuery({
    queryKey: queryKeys.sectors,
    queryFn: api.sectors,
  });
  const groups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
  });
  const products = useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
    enabled: !!id,
  });

  const [base, setBase] = useState<Product | null>(null);
  const [form, setForm] = useState<BuilderState>(emptyState());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [trying, setTrying] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  // Carrega o produto (edição) ou sugere categoria/setor de lanches (novo).
  useEffect(() => {
    if (loaded.current) return;
    if (id) {
      const product = products.data?.find((p) => p.id === id);
      if (!product) return;
      setBase(product);
      setForm(fromProduct(product));
      loaded.current = true;
    } else if (categories.data && sectors.data) {
      const lanches = categories.data.find(
        (c) => c.active && /lanche|hamb|sandu/i.test(c.name),
      );
      const cozinha = sectors.data.find((s) => /cozinha/i.test(s.name));
      setForm(emptyState(lanches?.id ?? '', cozinha?.id ?? NO_SECTOR));
      loaded.current = true;
    }
  }, [id, products.data, categories.data, sectors.data]);

  const set = <K extends keyof BuilderState>(
    key: K,
    value: BuilderState[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key === 'priceText' ? 'price' : key]: '' }));
  };

  const category = categories.data?.find((c) => c.id === form.categoryId);
  const groupById = new Map(groups.data?.map((g) => [g.id, g]));
  const inherited = (category?.optionGroupIds ?? [])
    .map((gid) => groupById.get(gid))
    .filter((g): g is OptionGroup => !!g);
  const priceCents = parseCents(form.priceText);

  /** Produto "de mentira" para a prévia e o teste como garçom. */
  const draft: Product = useMemo(
    () => ({
      id: base?.id ?? 'draft',
      categoryId: form.categoryId,
      sectorId: form.sectorId === NO_SECTOR ? null : form.sectorId,
      code: form.code || null,
      name: form.name || 'Novo lanche',
      description: form.description || null,
      priceCents: priceCents ?? 0,
      available: true,
      allowFractional: false,
      active: true,
      optionGroupIds: form.optionGroupIds,
      excludedOptionGroupIds: form.excludedOptionGroupIds,
      ingredients: form.recipe,
      maxFlavors: null,
      icon: base?.icon ?? null,
      version: base?.version ?? 1,
      updatedAt: new Date().toISOString(),
    }),
    [form, base, priceCents],
  );
  const effective = [
    ...inherited.filter((g) => !form.excludedOptionGroupIds.includes(g.id)),
    ...form.optionGroupIds
      .map((gid) => groupById.get(gid))
      .filter((g): g is OptionGroup => !!g),
  ].filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i);

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        name: form.name.trim(),
        priceCents: priceCents ?? 0,
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        categoryId: form.categoryId,
        sectorId: form.sectorId === NO_SECTOR ? null : form.sectorId,
        optionGroupIds: form.optionGroupIds,
        // Só guarda desligado o que ainda vem da categoria.
        excludedOptionGroupIds: form.excludedOptionGroupIds.filter((gid) =>
          category?.optionGroupIds.includes(gid),
        ),
        ingredients: form.recipe.map((r) => ({
          ingredientId: r.ingredientId,
          adjustable: r.adjustable,
        })),
      };
      return base
        ? api.updateProduct(base.id, { version: base.version, ...values })
        : api.createProduct(values);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        const field = (error.body?.details as { field?: string } | undefined)
          ?.field;
        if (error.code === errorCodes.conflict && field) {
          return setErrors({ [field]: error.message });
        }
        if (error.code === errorCodes.versionConflict) {
          toast.error('Alterado em outro aparelho', {
            description: 'Recarregamos o lanche; refaça a alteração.',
          });
          loaded.current = false;
          void qc.invalidateQueries({ queryKey: queryKeys.products });
          return;
        }
      }
      toastError(error);
    },
  });

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Dê um nome ao lanche.';
    if (priceCents === null || priceCents <= 0)
      next.price = 'Informe o preço (ex.: 29,90).';
    if (!form.categoryId) next.categoryId = 'Escolha a categoria.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSave(another: boolean) {
    if (!validate()) return;
    const product = await save.mutateAsync().catch(() => null);
    if (!product) return;
    void qc.invalidateQueries({ queryKey: queryKeys.products });
    toast.success(`${product.name} ${base ? 'atualizado' : 'no cardápio'}`, {
      description: `${formatCents(product.priceCents)} · já aparece para o garçom`,
    });
    if (another) {
      // Mantém receita e complementos; muda só o que diferencia o próximo.
      setBase(null);
      setForm((f) => ({ ...f, name: '', code: '', priceText: f.priceText }));
      navigate('/produtos/montar', { replace: true });
      setTimeout(() => nameRef.current?.focus(), 50);
    } else {
      navigate('/produtos');
    }
  }

  if (id && !base && (products.isLoading || !loaded.current)) {
    return (
      <PageBody className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </PageBody>
    );
  }

  return (
    <>
      <div className="border-b bg-background px-4 py-5 md:px-8 md:py-6">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link to="/produtos">
            <ArrowLeft /> Produtos
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ChefHat className="size-6 text-primary" />
          {base ? `Editar ${base.name}` : 'Montar lanche'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha os ingredientes e os complementos; o lanche entra no cardápio
          do garçom assim que for salvo.
        </p>
      </div>

      <PageBody className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-6">
          <Card className="gap-5">
            <CardHeader>
              <CardTitle>1. Básico</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Nome" htmlFor="b-name" error={errors.name}>
                <Input
                  id="b-name"
                  ref={nameRef}
                  autoFocus={!id}
                  maxLength={120}
                  placeholder="Ex.: X-Frango"
                  value={form.name}
                  aria-invalid={!!errors.name || undefined}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Field label="Preço" htmlFor="b-price" error={errors.price}>
                  <MoneyInput
                    id="b-price"
                    value={form.priceText}
                    onChange={(v) => set('priceText', v)}
                    invalid={!!errors.price}
                  />
                </Field>
                <Field label="Categoria" error={errors.categoryId}>
                  <Select
                    value={form.categoryId}
                    onValueChange={(v) => set('categoryId', v)}
                  >
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Escolha" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.data
                        ?.filter((c) => c.active || c.id === form.categoryId)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Código (opcional)"
                  htmlFor="b-code"
                  error={errors.code}
                >
                  <Input
                    id="b-code"
                    maxLength={20}
                    placeholder="XF01"
                    className="h-11 font-mono uppercase"
                    value={form.code}
                    onChange={(e) =>
                      set(
                        'code',
                        e.target.value.toUpperCase().replace(/\s/g, ''),
                      )
                    }
                  />
                </Field>
              </div>
              <Field label="Preparado em">
                <Select
                  value={form.sectorId}
                  onValueChange={(v) => set('sectorId', v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SECTOR}>Nenhum setor</SelectItem>
                    {sectors.data?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card className="gap-5">
            <CardHeader>
              <CardTitle>2. Ingredientes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <IngredientSearch
                chosen={form.recipe.map((r) => r.ingredientId)}
                onPick={(i) =>
                  set('recipe', [
                    ...form.recipe,
                    {
                      ingredientId: i.id,
                      name: i.name,
                      adjustable: !looksFixed(i.name),
                    },
                  ])
                }
              />
              {form.recipe.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Busque e clique nos ingredientes da receita. Se não existir,
                  Enter cria na hora.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {form.recipe.map((r, i) => (
                    <li
                      key={r.ingredientId}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <span className="w-5 text-xs text-muted-foreground tabular">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {r.name}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="hidden sm:inline">
                          {r.adjustable ? 'Sem/Pouco/Extra' : 'Fixo'}
                        </span>
                        <Switch
                          checked={r.adjustable}
                          aria-label={`${r.name}: cliente pode ajustar`}
                          onCheckedChange={(adjustable) =>
                            set(
                              'recipe',
                              form.recipe.map((x) =>
                                x.ingredientId === r.ingredientId
                                  ? { ...x, adjustable }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Subir ${r.name}`}
                        disabled={i === 0}
                        onClick={() =>
                          set('recipe', move(form.recipe, i, i - 1))
                        }
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Descer ${r.name}`}
                        disabled={i === form.recipe.length - 1}
                        onClick={() =>
                          set('recipe', move(form.recipe, i, i + 1))
                        }
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Tirar ${r.name}`}
                        onClick={() =>
                          set(
                            'recipe',
                            form.recipe.filter(
                              (x) => x.ingredientId !== r.ingredientId,
                            ),
                          )
                        }
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Fixo: pão, carne — não aparece para ajuste. Os demais o garçom
                pode marcar Sem, Pouco ou Extra (sem custo).
              </p>
            </CardContent>
          </Card>

          <Card className="gap-5">
            <CardHeader>
              <CardTitle>3. Complementos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {inherited.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Da categoria {category?.name}
                  </p>
                  <ul className="divide-y rounded-lg border">
                    {inherited.map((g) => {
                      const on = !form.excludedOptionGroupIds.includes(g.id);
                      return (
                        <li key={g.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                            <Switch
                              checked={on}
                              onCheckedChange={(v) =>
                                set(
                                  'excludedOptionGroupIds',
                                  v
                                    ? form.excludedOptionGroupIds.filter(
                                        (x) => x !== g.id,
                                      )
                                    : [...form.excludedOptionGroupIds, g.id],
                                )
                              }
                            />
                            <span
                              className={cn(
                                'min-w-0 flex-1',
                                !on && 'opacity-50',
                              )}
                            >
                              <span className="block text-sm font-medium">
                                {g.name}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {on
                                  ? ruleLabel(g)
                                  : 'Desligado só neste lanche'}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">Só deste lanche</p>
                <GroupPicker
                  value={form.optionGroupIds}
                  onChange={(ids) => set('optionGroupIds', ids)}
                  inherited={category?.optionGroupIds}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="gap-5">
            <CardHeader>
              <CardTitle>4. Descrição (opcional)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={2}
                maxLength={500}
                placeholder={
                  form.recipe.length
                    ? `Se vazio, o garçom vê os ingredientes: ${form.recipe.map((r) => r.name).join(', ')}`
                    : 'Ex.: o mais pedido da casa'
                }
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="size-4 text-muted-foreground" /> Prévia
                do garçom
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-48 rounded-lg border bg-card p-3">
                <div className="line-clamp-2 text-sm font-medium">
                  {draft.name}
                </div>
                <div className="mt-2 text-sm text-muted-foreground tabular">
                  {formatCents(draft.priceCents)}
                  {(effective.length > 0 ||
                    form.recipe.some((r) => r.adjustable)) && (
                    <ListPlus className="ml-1 inline size-3.5 align-[-2px]" />
                  )}
                </div>
              </div>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Ao tocar</dt>
                  <dd>
                    {effective.some((g) => g.minSelect > 0)
                      ? `abre a escolha (obrigatório: ${effective
                          .filter((g) => g.minSelect > 0)
                          .map((g) => g.name)
                          .join(', ')})`
                      : 'entra direto no carrinho; “Personalizar” ajusta'}
                  </dd>
                </div>
                {effective.length > 0 && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Complementos
                    </dt>
                    <dd className="flex flex-wrap gap-1 pt-1">
                      {effective.map((g) => (
                        <Badge
                          key={g.id}
                          variant={g.minSelect > 0 ? 'default' : 'secondary'}
                        >
                          {g.name}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Exemplo na cozinha
                  </dt>
                  <dd className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs uppercase">
                    1× {draft.name}
                    {example(form.recipe, effective)}
                  </dd>
                </div>
              </dl>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!form.name.trim()}
                onClick={() => setTrying(true)}
              >
                <Smartphone /> Testar como garçom
              </Button>
            </CardContent>
          </Card>
        </aside>
      </PageBody>

      <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:pl-[calc(15rem+1rem)]">
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => onSave(true)}
        >
          <Copy /> Salvar e montar outro parecido
        </Button>
        <Button disabled={save.isPending} onClick={() => onSave(false)}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Salvar lanche
        </Button>
      </div>

      <OptionPicker
        product={trying ? draft : null}
        groups={effective}
        allGroups={groups.data ?? []}
        confirmLabel="Simular"
        onClose={() => setTrying(false)}
        onConfirm={(r) => {
          setTrying(false);
          toast.info('Assim sairia na comanda', {
            description: [
              `${r.quantity}× ${draft.name}`,
              r.options.map((o) => o.name).join(', '),
              adjustmentsText(r.adjustments),
            ]
              .filter(Boolean)
              .join(' · '),
          });
        }}
      />
    </>
  );
}

/** Base do lanche (pão, carne) entra como fixa; o administrador pode trocar. */
const looksFixed = (name: string) =>
  /^(p[ãa]o|blend|fil[ée]|carne|hamb[úu]rguer|smash)\b/i.test(name.trim());

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Linha de exemplo: primeiro ajustável como "sem" e primeira opção paga. */
function example(recipe: RecipeLine[], groups: OptionGroup[]) {
  const parts: string[] = [];
  const adjustable = recipe.find((r) => r.adjustable);
  if (adjustable) parts.push(`sem ${adjustable.name}`);
  const paid = groups.flatMap((g) => g.options).find((o) => o.priceCents > 0);
  if (paid) parts.push(`+ ${paid.name}`);
  return parts.length ? ` — ${parts.join(' · ')}` : '';
}

/** Busca na biblioteca; Enter escolhe o primeiro resultado ou cria o ingrediente. */
function IngredientSearch({
  chosen,
  onPick,
}: {
  chosen: string[];
  onPick: (i: Ingredient) => void;
}) {
  const qc = useQueryClient();
  const library = useQuery({
    queryKey: queryKeys.ingredients,
    queryFn: () => api.ingredients(),
  });
  const [term, setTerm] = useState('');
  const create = useMutation({
    mutationFn: async (name: string) => {
      try {
        return await api.createIngredient({ name });
      } catch (e) {
        // Já existe (talvez arquivado): reaproveita.
        if (e instanceof ApiRequestError && e.code === errorCodes.conflict) {
          const all = await api.ingredients({ status: 'all' });
          const found = all.find((i) => normalize(i.name) === normalize(name));
          if (found) return found;
        }
        throw e;
      }
    },
    onSuccess: (i) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ingredients });
      onPick(i);
      setTerm('');
    },
    onError: toastError,
  });

  const q = normalize(term);
  const available = (library.data ?? []).filter((i) => !chosen.includes(i.id));
  const matches = q
    ? available.filter((i) => normalize(i.name).includes(q))
    : available;
  const exact = (library.data ?? []).some((i) => normalize(i.name) === q);

  function pick(i: Ingredient) {
    onPick(i);
    setTerm('');
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar ingrediente (ex.: frango, alface)…"
          className="pl-9"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (matches[0] && q) pick(matches[0]);
            else if (term.trim() && !exact) create.mutate(term.trim());
          }}
        />
      </div>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {matches.slice(0, 24).map((i) => (
          <Button
            key={i.id}
            type="button"
            size="xs"
            variant="outline"
            className="rounded-full"
            onClick={() => pick(i)}
          >
            <Plus /> {i.name}
          </Button>
        ))}
        {term.trim() && !exact && (
          <Button
            type="button"
            size="xs"
            className="rounded-full"
            disabled={create.isPending}
            onClick={() => create.mutate(term.trim())}
          >
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Criar “{term.trim()}”
          </Button>
        )}
        {!term && available.length === 0 && library.data?.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Biblioteca vazia: digite o nome e tecle Enter para criar.
          </span>
        )}
      </div>
    </div>
  );
}
