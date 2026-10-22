import { parseCents } from '@muquifo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, queryKeys } from '@/api';
import { FigureTile } from '@/components/figure-picker';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { applyPizzaKit } from '@/components/pizza-kit';
import { applyLanchoneteKit } from '@/components/starter-kit';
import { Button } from '@/components/ui/button';
import { toastError } from '@/lib/errors';
import {
  figureOf,
  guessFigure,
  type ItemKind,
  kindFigure,
} from '@/lib/figures';
import { ensureCategory, kindCategory, sectorFor } from '@/lib/menu-setup';
import { cn } from '@/lib/utils';

type BusinessKey =
  | 'lanchonete'
  | 'pizzaria'
  | 'bar'
  | 'restaurante'
  | 'acai'
  | 'cafe';

type Suggestion = [name: string, priceCents: number, kind: ItemKind];

/** Itens mais comuns de cada negócio, com preços de partida. */
const businesses: {
  key: BusinessKey;
  label: string;
  emoji: string;
  hint: string;
  items: Suggestion[];
}[] = [
  {
    key: 'lanchonete',
    label: 'Lanchonete',
    emoji: '🍔',
    hint: 'Hambúrguer, lanches, porções',
    items: [
      ['X-Burger', 2500, 'burger'],
      ['X-Salada', 2700, 'burger'],
      ['X-Bacon', 3000, 'burger'],
      ['X-Tudo', 3500, 'burger'],
      ['Misto quente', 1200, 'burger'],
      ['Batata frita', 2200, 'side'],
    ],
  },
  {
    key: 'pizzaria',
    label: 'Pizzaria',
    emoji: '🍕',
    hint: 'Tamanhos, sabores e bordas',
    items: [],
  },
  {
    key: 'bar',
    label: 'Bar',
    emoji: '🍺',
    hint: 'Cerveja, drinks e petiscos',
    items: [
      ['Cerveja 600ml', 1400, 'drink'],
      ['Cerveja long neck', 1000, 'drink'],
      ['Caipirinha', 1800, 'drink'],
      ['Dose de cachaça', 600, 'drink'],
      ['Calabresa acebolada', 3500, 'side'],
      ['Batata frita', 2200, 'side'],
      ['Isca de frango', 3800, 'side'],
    ],
  },
  {
    key: 'restaurante',
    label: 'Restaurante',
    emoji: '🍛',
    hint: 'Pratos, refeições e saladas',
    items: [
      ['Prato feito', 2500, 'dish'],
      ['Filé com fritas', 4500, 'dish'],
      ['Frango grelhado', 3200, 'dish'],
      ['Feijoada', 4000, 'dish'],
      ['Salada da casa', 1800, 'dish'],
      ['Pudim', 1000, 'dessert'],
    ],
  },
  {
    key: 'acai',
    label: 'Açaí e sorvete',
    emoji: '🍧',
    hint: 'Açaí, sorvete, milk-shake',
    items: [
      ['Açaí 300ml', 1500, 'dessert'],
      ['Açaí 500ml', 2200, 'dessert'],
      ['Sorvete 2 bolas', 1200, 'dessert'],
      ['Milk-shake', 1800, 'drink'],
    ],
  },
  {
    key: 'cafe',
    label: 'Cafeteria',
    emoji: '☕',
    hint: 'Café, salgados e doces',
    items: [
      ['Café expresso', 500, 'drink'],
      ['Cappuccino', 900, 'drink'],
      ['Pão de queijo', 600, 'side'],
      ['Misto quente', 1200, 'burger'],
      ['Bolo (fatia)', 900, 'dessert'],
    ],
  },
];

/** Bebidas que quase todo lugar vende. */
const commonDrinks: Suggestion[] = [
  ['Refrigerante lata', 600, 'drink'],
  ['Refrigerante 2L', 1400, 'drink'],
  ['Água sem gás', 400, 'drink'],
  ['Suco natural', 900, 'drink'],
];

interface Row {
  name: string;
  kind: ItemKind;
  priceText: string;
  on: boolean;
}

const kindOrder: ItemKind[] = [
  'burger',
  'dish',
  'side',
  'drink',
  'dessert',
  'other',
];

type Step = 'business' | 'tables' | 'review' | 'applying' | 'done';

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Primeiro acesso: "Seu negócio é...?", quantas mesas e a lista de itens
 * sugeridos com preço editável. Um toque monta o cardápio e o salão.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tables = useQuery({ queryKey: queryKeys.tables, queryFn: api.tables });
  const products = useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
  });
  const [step, setStep] = useState<Step>('business');
  const [picked, setPicked] = useState<Set<BusinessKey>>(new Set());
  const [tableCount, setTableCount] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [withPizza, setWithPizza] = useState(true);
  const [withBurgerExtras, setWithBurgerExtras] = useState(true);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<string[]>([]);

  const existingTables = (tables.data ?? []).filter((t) => t.active).length;
  const mesas = tableCount ?? Math.max(existingTables, 10);
  const hasProduct = (name: string) =>
    (products.data ?? []).some((p) => p.active && same(p.name, name));

  function toggle(key: BusinessKey) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Monta a lista sugerida, sem repetir nem trazer o que já existe. */
  function toReview() {
    const list: Row[] = [];
    const add = ([name, priceCents, kind]: Suggestion) => {
      if (list.some((r) => same(r.name, name)) || hasProduct(name)) return;
      list.push({ name, kind, priceText: centsToInput(priceCents), on: true });
    };
    for (const b of businesses) if (picked.has(b.key)) b.items.forEach(add);
    commonDrinks.forEach(add);
    setRows(list);
    setStep('tables');
  }

  async function apply() {
    setStep('applying');
    const done: string[] = [];
    try {
      // Mesas que faltam, de 1 até o número escolhido.
      const numbers = new Set((tables.data ?? []).map((t) => t.number));
      let tablesCreated = 0;
      for (let n = 1; n <= mesas; n++) {
        if (numbers.has(n)) continue;
        setProgress(`Criando a mesa ${n}…`);
        await api.createTable({ number: n });
        tablesCreated++;
      }
      if (tablesCreated) done.push(`${tablesCreated} mesas no salão`);

      const [categories, sectors] = await Promise.all([
        api.categories(),
        api.sectors(),
      ]);
      const chosen = rows.filter((r) => r.on && r.name.trim());
      for (const [i, r] of chosen.entries()) {
        setProgress(
          `Colocando no cardápio: ${r.name} (${i + 1}/${chosen.length})`,
        );
        const category = await ensureCategory(r.kind, categories);
        await api.createProduct({
          categoryId: category.id,
          sectorId: sectorFor(r.kind, sectors),
          name: r.name.trim(),
          priceCents: parseCents(r.priceText) ?? 0,
          icon: guessFigure(r.name) ?? kindFigure[r.kind],
        });
      }
      if (chosen.length) done.push(`${chosen.length} itens no cardápio`);

      if (picked.has('lanchonete') && withBurgerExtras) {
        setProgress('Preparando adicionais, pão e combo dos lanches…');
        const lanches = await ensureCategory('burger', categories);
        await applyLanchoneteKit({ category: lanches });
        done.push('adicionais e combo nos lanches');
      }
      if (picked.has('pizzaria') && withPizza) {
        setProgress('Montando a pizzaria…');
        const pizzaSector =
          sectors.find((s) => /pizza|forno/i.test(s.name))?.id ??
          sectorFor('pizza', sectors);
        const r = await applyPizzaKit({
          category: null,
          sectorId: pizzaSector,
        });
        done.push(`pizzaria com 3 tamanhos e ${r.flavorsCreated} sabores`);
      }
      setSummary(done);
      setStep('done');
    } catch (e) {
      // O que já foi criado fica; refazer pula o que já existe.
      toastError(e);
      setStep('review');
    } finally {
      for (const key of [
        queryKeys.tables,
        queryKeys.categories,
        queryKeys.products,
        queryKeys.optionGroups,
        queryKeys.pizzaTiers,
        queryKeys.pizzaFlavors,
        queryKeys.ingredients,
      ])
        void qc.invalidateQueries({ queryKey: key });
    }
  }

  const onCount = rows.filter((r) => r.on).length;
  const order: Step[] = ['business', 'tables', 'review', 'done'];
  const position = order.indexOf(step === 'applying' ? 'review' : step);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl flex-col px-4 py-5 md:py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        {step === 'business' ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft /> Voltar
          </Button>
        ) : step === 'tables' || step === 'review' ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => setStep(step === 'review' ? 'tables' : 'business')}
          >
            <ArrowLeft /> Voltar
          </Button>
        ) : (
          <span />
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

      {step === 'business' && (
        <section className="space-y-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Seu negócio é…
            </h1>
            <p className="text-muted-foreground">
              Pode marcar mais de um. Vamos montar o cardápio para você.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {businesses.map((b) => {
              const on = picked.has(b.key);
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(b.key)}
                  className={cn(
                    'relative flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center transition active:scale-[0.98]',
                    on
                      ? 'border-primary bg-primary/10'
                      : 'hover:border-primary/50',
                  )}
                >
                  {on && (
                    <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-4" />
                    </span>
                  )}
                  <FigureTile emoji={b.emoji} size="lg" />
                  <span className="text-lg font-semibold">{b.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.hint}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            size="lg"
            className="h-14 w-full text-lg"
            disabled={
              picked.size === 0 || products.isLoading || tables.isLoading
            }
            onClick={toReview}
          >
            Continuar <ChevronRight />
          </Button>
        </section>
      )}

      {step === 'tables' && (
        <section className="space-y-6 text-center">
          <FigureTile emoji="🪑" size="xl" className="mx-auto" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Quantas mesas você tem?
            </h1>
            <p className="text-muted-foreground">
              Elas aparecem no Salão com os números 1, 2, 3…
            </p>
          </div>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="icon"
              variant="outline"
              className="size-14 rounded-full"
              aria-label="Menos mesas"
              disabled={mesas <= existingTables || mesas <= 0}
              onClick={() => setTableCount(mesas - 1)}
            >
              <Minus />
            </Button>
            <span className="w-24 text-6xl font-semibold tabular">{mesas}</span>
            <Button
              size="icon"
              variant="outline"
              className="size-14 rounded-full"
              aria-label="Mais mesas"
              disabled={mesas >= 200}
              onClick={() => setTableCount(mesas + 1)}
            >
              <Plus />
            </Button>
          </div>
          {existingTables > 0 && (
            <p className="text-sm text-muted-foreground">
              Você já tem {existingTables}{' '}
              {existingTables === 1 ? 'mesa' : 'mesas'}; só criamos as que
              faltam.
            </p>
          )}
          <div className="space-y-2">
            <Button
              size="lg"
              className="h-14 w-full text-lg"
              onClick={() => setStep('review')}
            >
              Continuar <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setTableCount(existingTables);
                setStep('review');
              }}
            >
              Só atendo no balcão
            </Button>
          </div>
        </section>
      )}

      {step === 'review' && (
        <section className="space-y-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Seu cardápio inicial
            </h1>
            <p className="text-muted-foreground">
              Confira os preços e desmarque o que você não vende. Dá para mudar
              tudo depois.
            </p>
          </div>

          {picked.has('pizzaria') && (
            <ToggleCard
              emoji="🍕"
              title="Pizzaria pronta"
              text="Pequena (1 sabor), Média (2) e Grande (3), 16 sabores em 3 faixas de preço e borda recheada."
              on={withPizza}
              onToggle={() => setWithPizza((v) => !v)}
            />
          )}
          {picked.has('lanchonete') && (
            <ToggleCard
              emoji="🧀"
              title="Opções dos lanches"
              text="Adicionais (bacon, cheddar, ovo), tipo de pão, molhos e combo com bebida."
              on={withBurgerExtras}
              onToggle={() => setWithBurgerExtras((v) => !v)}
            />
          )}

          {kindOrder.map((kind) => {
            const list = rows
              .map((r, index) => ({ r, index }))
              .filter(({ r }) => r.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind} className="space-y-2">
                <h2 className="flex items-center gap-2 font-semibold">
                  <span aria-hidden>{kindFigure[kind]}</span>
                  {kindCategory[kind]}
                </h2>
                <ul className="divide-y rounded-2xl border bg-card">
                  {list.map(({ r, index }) => (
                    <li
                      key={r.name}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2',
                        !r.on && 'opacity-50',
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={r.on}
                        aria-label={
                          r.on ? `Tirar ${r.name}` : `Incluir ${r.name}`
                        }
                        onClick={() =>
                          setRows((rs) =>
                            rs.map((x, i) =>
                              i === index ? { ...x, on: !x.on } : x,
                            ),
                          )
                        }
                        className={cn(
                          'grid size-7 shrink-0 place-items-center rounded-md border',
                          r.on &&
                            'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {r.on && <Check className="size-4" />}
                      </button>
                      <FigureTile
                        emoji={figureOf(
                          { icon: null, name: r.name },
                          kindCategory[kind],
                        )}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {r.name}
                      </span>
                      <div className="w-32 shrink-0">
                        <MoneyInput
                          id={`onb-${index}`}
                          className="h-10 text-base md:text-base"
                          value={r.priceText}
                          onChange={(v) =>
                            setRows((rs) =>
                              rs.map((x, i) =>
                                i === index ? { ...x, priceText: v } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <Button
            size="lg"
            className="h-14 w-full text-lg"
            disabled={
              onCount === 0 &&
              !(picked.has('pizzaria') && withPizza) &&
              mesas <= existingTables
            }
            onClick={() => void apply()}
          >
            <Check /> Montar meu cardápio
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {onCount} {onCount === 1 ? 'item' : 'itens'}
            {mesas > existingTables &&
              ` · ${mesas - existingTables} mesas novas`}
          </p>
        </section>
      )}

      {step === 'applying' && (
        <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Loader2 className="size-12 animate-spin text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Montando tudo…
          </h1>
          <p className="text-muted-foreground">{progress}</p>
        </section>
      )}

      {step === 'done' && (
        <section className="space-y-6 text-center">
          <div className="relative mx-auto w-fit">
            <FigureTile emoji="🎉" size="xl" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Tudo pronto!
            </h1>
            <ul className="space-y-1 text-lg text-muted-foreground">
              {summary.map((s) => (
                <li key={s} className="flex items-center justify-center gap-2">
                  <Check className="size-5 text-free" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <Button size="lg" className="h-14 w-full text-lg" asChild>
              <Link to="/">Abrir o salão</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 w-full" asChild>
              <Link to="/produtos">Ver o cardápio</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Os preços sugeridos são de partida: toque em qualquer item do
            cardápio para mudar.
          </p>
        </section>
      )}
    </div>
  );
}

function ToggleCard({
  emoji,
  title,
  text,
  on,
  onToggle,
}: {
  emoji: string;
  title: string;
  text: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition',
        on ? 'border-primary bg-primary/10' : 'bg-card opacity-60',
      )}
    >
      <FigureTile emoji={emoji} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md border',
          on && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        {on && <Check className="size-4" />}
      </span>
    </button>
  );
}
