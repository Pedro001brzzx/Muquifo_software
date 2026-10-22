import {
  errorCodes,
  formatCents,
  type OptionGroup,
  type Product,
  parseCents,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { FigurePicker, FigureTile } from '@/components/figure-picker';
import { MoneyInput } from '@/components/money-input';
import { PizzaKitDialog } from '@/components/pizza-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toastError } from '@/lib/errors';
import { guessFigure, type ItemKind, kindFigure } from '@/lib/figures';
import { ensureCategory, sectorFor } from '@/lib/menu-setup';
import { cn } from '@/lib/utils';

type Step =
  | 'kind'
  | 'pizza-setup'
  | 'name'
  | 'price'
  | 'pizza-tier'
  | 'extras'
  | 'done';

const kinds: {
  kind: ItemKind;
  label: string;
  /** "outra bebida", "outro lanche". */
  another: string;
  hint: string;
}[] = [
  {
    kind: 'burger',
    label: 'Lanche',
    another: 'outro lanche',
    hint: 'Hambúrguer, sanduíche, pastel',
  },
  {
    kind: 'pizza',
    label: 'Pizza',
    another: 'outro sabor',
    hint: 'Novo sabor de pizza',
  },
  {
    kind: 'drink',
    label: 'Bebida',
    another: 'outra bebida',
    hint: 'Refrigerante, suco, cerveja',
  },
  {
    kind: 'side',
    label: 'Porção',
    another: 'outra porção',
    hint: 'Batata, petiscos',
  },
  {
    kind: 'dessert',
    label: 'Sobremesa',
    another: 'outra sobremesa',
    hint: 'Doces, sorvete, açaí',
  },
  {
    kind: 'dish',
    label: 'Prato',
    another: 'outro prato',
    hint: 'Prato feito, massa, carne',
  },
  {
    kind: 'other',
    label: 'Outro',
    another: 'outro item',
    hint: 'Qualquer outro item',
  },
];

/** Tipos que costumam ter ingredientes para tirar e extras. */
const customizable: ItemKind[] = ['burger', 'side', 'dish'];

const sizeLabel = (name: string) => name.replace(/^pizza\s+/i, '');

/**
 * Assistente de cadastro: uma pergunta por tela, figuras grandes e o
 * resto preenchido sozinho (categoria, setor, figura).
 */
export function AddItemPage() {
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
  const products = useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
  });
  const tiers = useQuery({
    queryKey: queryKeys.pizzaTiers,
    queryFn: () => api.pizzaTiers(),
  });

  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<ItemKind>('burger');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [figure, setFigure] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [kitOpen, setKitOpen] = useState(false);
  const [created, setCreated] = useState<Product | null>(null);
  const [doneText, setDoneText] = useState('');

  const meta = kinds.find((k) => k.kind === kind)!;
  const shownFigure = figure ?? guessFigure(name) ?? kindFigure[kind];
  const sizes = (products.data ?? []).filter(
    (p) => p.active && p.maxFlavors !== null,
  );
  const pizzaReady = sizes.length > 0 && (tiers.data ?? []).length > 0;

  function reset(next: Step) {
    setName('');
    setDescription('');
    setFigure(null);
    setPriceText('');
    setError('');
    setCreated(null);
    setStep(next);
  }

  function chooseKind(k: ItemKind) {
    setKind(k);
    reset(k === 'pizza' && !pizzaReady ? 'pizza-setup' : 'name');
  }

  function back() {
    const previous: Partial<Record<Step, Step>> = {
      'pizza-setup': 'kind',
      name: 'kind',
      price: 'name',
      'pizza-tier': 'name',
    };
    const to = previous[step];
    if (to) setStep(to);
    else navigate('/produtos');
  }

  const saveProduct = useMutation({
    mutationFn: async () => {
      const category = await ensureCategory(kind, [...(categories.data ?? [])]);
      return api.createProduct({
        categoryId: category.id,
        sectorId: sectorFor(kind, sectors.data),
        name: name.trim(),
        priceCents: parseCents(priceText) ?? 0,
        icon: shownFigure,
      });
    },
    onSuccess: (p) => {
      setCreated(p);
      setDoneText(
        `${p.name} está no cardápio por ${formatCents(p.priceCents)}.`,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.products });
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      setStep(customizable.includes(kind) ? 'extras' : 'done');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === errorCodes.conflict) {
        setError(e.message);
        setStep('name');
        return;
      }
      toastError(e);
    },
  });

  const saveFlavor = useMutation({
    mutationFn: (tierId: string) =>
      api.createPizzaFlavor({
        tierId,
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: (f) => {
      const tier = tiers.data?.find((t) => t.id === f.tierId);
      setDoneText(
        `A pizza de ${f.name} já pode ser pedida${tier ? ` (preço ${tier.name.toLowerCase()})` : ''}.`,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.pizzaFlavors });
      void qc.invalidateQueries({ queryKey: queryKeys.pizzaTiers });
      setStep('done');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === errorCodes.conflict) {
        setError('Já existe um sabor com esse nome.');
        setStep('name');
        return;
      }
      toastError(e);
    },
  });

  function submitName(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Escreva o nome.');
    setError('');
    setStep(kind === 'pizza' ? 'pizza-tier' : 'price');
  }

  function submitPrice(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(priceText);
    if (cents === null || cents <= 0) return setError('Escreva o preço.');
    setError('');
    saveProduct.mutate();
  }

  const order: Step[] =
    kind === 'pizza'
      ? ['kind', 'name', 'pizza-tier', 'done']
      : customizable.includes(kind)
        ? ['kind', 'name', 'price', 'extras', 'done']
        : ['kind', 'name', 'price', 'done'];
  const position = Math.max(0, order.indexOf(step));

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl flex-col px-4 py-5 md:py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        {step === 'done' || step === 'extras' ? (
          <span />
        ) : (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={back}>
            <ArrowLeft /> Voltar
          </Button>
        )}
        <div className="flex gap-1.5" aria-hidden>
          {order.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1.5 w-6 rounded-full bg-muted',
                i <= position && 'bg-primary',
              )}
            />
          ))}
        </div>
      </div>

      {step === 'kind' && (
        <section className="space-y-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            O que você vai vender?
          </h1>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {kinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => chooseKind(k.kind)}
                className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center transition hover:border-primary/60 hover:bg-accent/50 active:scale-[0.98]"
              >
                <FigureTile emoji={kindFigure[k.kind]} size="lg" />
                <span className="text-lg font-semibold">{k.label}</span>
                <span className="text-xs text-muted-foreground">{k.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'pizza-setup' && (
        <section className="space-y-5 text-center">
          <FigureTile emoji="🍕" size="xl" className="mx-auto" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Primeiro, os tamanhos e preços da pizza
          </h1>
          <p className="text-muted-foreground">
            Com um toque criamos Pequena (1 sabor), Média (2) e Grande (3), com
            preços que você ajusta depois, e os sabores mais pedidos.
          </p>
          {pizzaReady ? (
            <Button
              size="lg"
              className="h-14 w-full text-lg"
              onClick={() => reset('name')}
            >
              Pronto! Cadastrar um sabor <ChevronRight />
            </Button>
          ) : (
            <Button
              size="lg"
              className="h-14 w-full text-lg"
              onClick={() => setKitOpen(true)}
            >
              <Sparkles /> Montar pizzaria pronta
            </Button>
          )}
          <Button variant="link" asChild>
            <Link to="/produtos/pizzaria">Prefiro configurar do meu jeito</Link>
          </Button>
        </section>
      )}

      {step === 'name' && (
        <form onSubmit={submitName} className="space-y-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {kind === 'pizza'
              ? 'Qual o sabor?'
              : `Qual o nome ${kind === 'drink' || kind === 'side' || kind === 'dessert' ? 'da' : 'do'} ${meta.label.toLowerCase()}?`}
          </h1>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="rounded-3xl transition active:scale-95"
              aria-label="Trocar figura"
            >
              <FigureTile
                emoji={kind === 'pizza' ? '🍕' : shownFigure}
                size="xl"
              />
            </button>
            {kind !== 'pizza' && (
              <button
                type="button"
                className="text-sm text-primary underline-offset-2 hover:underline"
                onClick={() => setPicking(true)}
              >
                Trocar figura
              </button>
            )}
          </div>
          <Input
            autoFocus
            maxLength={kind === 'pizza' ? 60 : 120}
            placeholder={
              {
                burger: 'Ex.: X-Salada',
                pizza: 'Ex.: Calabresa',
                drink: 'Ex.: Coca-Cola lata',
                side: 'Ex.: Batata frita',
                dessert: 'Ex.: Pudim',
                dish: 'Ex.: Prato feito de frango',
                other: 'Nome do item',
              }[kind]
            }
            className="h-14 text-xl md:text-xl"
            value={name}
            aria-invalid={!!error || undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
          />
          {kind === 'pizza' && (
            <Input
              maxLength={300}
              placeholder="Ingredientes (opcional): molho, mussarela, calabresa"
              className="h-12"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="h-14 w-full text-lg"
            disabled={!name.trim()}
          >
            Continuar <ChevronRight />
          </Button>
        </form>
      )}

      {step === 'price' && (
        <form onSubmit={submitPrice} className="space-y-5">
          <div className="flex items-center gap-3">
            <FigureTile emoji={shownFigure} size="lg" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Quanto custa {name.trim()}?
            </h1>
          </div>
          <MoneyInput
            id="wizard-price"
            autoFocus
            className="h-16 pl-14 text-3xl md:text-3xl"
            value={priceText}
            invalid={!!error}
            onChange={(v) => {
              setPriceText(v);
              setError('');
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="h-14 w-full text-lg"
            disabled={saveProduct.isPending || !priceText}
          >
            {saveProduct.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Check />
            )}
            Colocar no cardápio
          </Button>
        </form>
      )}

      {step === 'pizza-tier' && (
        <section className="space-y-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            A pizza de {name.trim()} custa como qual?
          </h1>
          <div className="space-y-3">
            {(tiers.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={saveFlavor.isPending}
                onClick={() => saveFlavor.mutate(t.id)}
                className="flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-accent/50 active:scale-[0.99] disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{t.name}</span>
                  <span className="block text-sm text-muted-foreground tabular">
                    {sizes
                      .map((s) => {
                        const price = t.prices.find(
                          (p) => p.productId === s.id,
                        );
                        return price
                          ? `${sizeLabel(s.name)} ${formatCents(s.priceCents + price.priceCents)}`
                          : null;
                      })
                      .filter(Boolean)
                      .join(' · ') || 'sem preço ainda'}
                  </span>
                </span>
                {saveFlavor.isPending && saveFlavor.variables === t.id ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <ChevronRight className="size-5 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Pizza com mais de um sabor cobra o mais caro. Os preços mudam em
            Pizzaria.
          </p>
        </section>
      )}

      {step === 'extras' && created && (
        <ExtrasStep
          product={created}
          onDone={(changed) => {
            if (changed) toast.success('Opções salvas');
            setStep('done');
          }}
        />
      )}

      {step === 'done' && (
        <section className="space-y-6 text-center">
          <div className="relative mx-auto w-fit">
            <FigureTile
              emoji={kind === 'pizza' ? '🍕' : shownFigure}
              size="xl"
            />
            <span className="absolute -right-2 -bottom-2 grid size-10 place-items-center rounded-full bg-free text-white shadow">
              <Check className="size-6" />
            </span>
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Pronto!</h1>
            <p className="text-lg text-muted-foreground">{doneText}</p>
            <p className="text-sm text-muted-foreground">
              O garçom já vê no cardápio.
            </p>
          </div>
          <div className="space-y-2">
            <Button
              size="lg"
              className="h-14 w-full text-lg"
              onClick={() => reset('name')}
            >
              <Plus /> Cadastrar {meta.another}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 w-full"
              onClick={() => reset('kind')}
            >
              Cadastrar outro tipo
            </Button>
            <Button variant="ghost" className="w-full" asChild>
              <Link to="/produtos">Ver o cardápio</Link>
            </Button>
          </div>
        </section>
      )}

      <FigurePicker
        open={picking}
        value={shownFigure}
        onClose={() => setPicking(false)}
        onPick={setFigure}
      />
      <PizzaKitDialog open={kitOpen} onClose={() => setKitOpen(false)} />
    </div>
  );
}

/** Perguntas opcionais de sim/não depois que o item já está no cardápio. */
function ExtrasStep({
  product,
  onDone,
}: {
  product: Product;
  onDone: (changed: boolean) => void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const groups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
  });
  const library = useQuery({
    queryKey: queryKeys.ingredients,
    queryFn: () => api.ingredients(),
  });
  const [removable, setRemovable] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<{ id: string; name: string }[]>([]);
  const [typed, setTyped] = useState('');
  const [off, setOff] = useState<Set<string>>(new Set());

  const offered = (
    categories.data?.find((c) => c.id === product.categoryId)?.optionGroupIds ??
    []
  )
    .map((id) => groups.data?.find((g) => g.id === id))
    .filter((g): g is OptionGroup => !!g);

  const term = typed.trim().toLowerCase();
  const suggestions = (library.data ?? [])
    .filter(
      (i) =>
        !chosen.some((c) => c.id === i.id) &&
        (!term || i.name.toLowerCase().includes(term)),
    )
    .slice(0, 18);

  const addTyped = useMutation({
    mutationFn: async () => {
      const existing = library.data?.find((i) => i.name.toLowerCase() === term);
      return existing ?? api.createIngredient({ name: typed.trim() });
    },
    onSuccess: (i) => {
      setChosen((c) => [...c, { id: i.id, name: i.name }]);
      setTyped('');
      void qc.invalidateQueries({ queryKey: queryKeys.ingredients });
    },
    onError: toastError,
  });

  const save = useMutation({
    mutationFn: () =>
      api.updateProduct(product.id, {
        version: product.version,
        ingredients: chosen.map((c) => ({
          ingredientId: c.id,
          adjustable: true,
        })),
        excludedOptionGroupIds: [...off],
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.products });
      onDone(true);
    },
    onError: toastError,
  });

  const changed = chosen.length > 0 || off.size > 0;

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {product.name} já está no cardápio!
        </h1>
        <p className="text-muted-foreground">
          Duas perguntas rápidas (pode pular).
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <h2 className="text-lg font-medium">
          O cliente pode pedir para tirar algum ingrediente?
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: false, label: 'Não' },
            { value: true, label: 'Sim' },
          ].map((o) => (
            <Button
              key={o.label}
              type="button"
              size="lg"
              variant={removable === o.value ? 'default' : 'outline'}
              className="h-12 text-base"
              onClick={() => {
                setRemovable(o.value);
                if (!o.value) setChosen([]);
              }}
            >
              {o.label}
            </Button>
          ))}
        </div>
        {removable && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Toque nos ingredientes que vão no {product.name}:
            </p>
            {chosen.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chosen.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      setChosen((list) => list.filter((x) => x.id !== c.id))
                    }
                  >
                    <Check /> {c.name}
                  </Button>
                ))}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) addTyped.mutate();
              }}
            >
              <Input
                placeholder="Procurar ou escrever outro"
                className="h-11"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                className="h-11"
                disabled={!typed.trim() || addTyped.isPending}
              >
                <Plus /> Incluir
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((i) => (
                <Button
                  key={i.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setChosen((c) => [...c, { id: i.id, name: i.name }]);
                    setTyped('');
                  }}
                >
                  <Plus /> {i.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {offered.length > 0 && (
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <h2 className="text-lg font-medium">O garçom vai oferecer junto:</h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            Toque para tirar o que não combina com {product.name}.
          </p>
          <div className="space-y-2">
            {offered.map((g) => {
              const on = !off.has(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setOff((s) => {
                      const next = new Set(s);
                      if (on) next.add(g.id);
                      else next.delete(g.id);
                      return next;
                    })
                  }
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                    on ? 'border-primary bg-primary/10' : 'opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-md border',
                      on && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {on && <Check className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{g.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {g.options.map((o) => o.name).join(', ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Button
          size="lg"
          className="h-14 w-full text-lg"
          disabled={save.isPending}
          onClick={() => (changed ? save.mutate() : onDone(false))}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
          {changed ? 'Salvar e concluir' : 'Concluir'}
        </Button>
      </div>
    </section>
  );
}
