import {
  type AdjustmentKind,
  adjustmentKindLabel,
  type OptionGroup,
  type PizzaFlavor,
  type PizzaTier,
  type Product,
} from '@muquifo/contracts';
import { Check, Minus, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ruleLabel } from '@/components/option-groups';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ChosenOption {
  optionId: string;
  groupName: string;
  name: string;
  priceCents: number;
}

export interface ChosenAdjustment {
  ingredientId: string;
  name: string;
  kind: AdjustmentKind;
}

export interface ChosenFlavor {
  flavorId: string;
  name: string;
  tierName: string;
  /** Preço da faixa neste tamanho; a pizza cobra o maior. */
  priceCents: number;
}

export interface PickerResult {
  options: ChosenOption[];
  adjustments: ChosenAdjustment[];
  flavors: ChosenFlavor[];
  quantity: number;
  notes: string;
}

/** Cardápio da pizzaria, para montar a escolha de sabores de um tamanho. */
export interface PizzaMenu {
  tiers: PizzaTier[];
  flavors: PizzaFlavor[];
}

/** Sabores vendidos no tamanho, por faixa, com o preço da faixa nele. */
export function flavorsForSize(menu: PizzaMenu | undefined, productId: string) {
  return (menu?.tiers ?? [])
    .filter((t) => t.active)
    .map((tier) => ({
      tier,
      priceCents: tier.prices.find((p) => p.productId === productId)
        ?.priceCents,
      flavors: (menu?.flavors ?? []).filter(
        (f) => f.active && f.tierId === tier.id,
      ),
    }))
    .filter(
      (t): t is typeof t & { priceCents: number } =>
        t.priceCents !== undefined && t.flavors.length > 0,
    );
}

/** Preço da pizza: o da faixa mais cara entre os sabores. */
export const flavorPrice = (flavors: { priceCents: number }[]) =>
  flavors.length ? Math.max(...flavors.map((f) => f.priceCents)) : 0;

/** Preço unitário: produto + sabor mais caro + complementos. */
export const unitPriceOf = (
  product: Product,
  r: Pick<PickerResult, 'options' | 'flavors'>,
) =>
  product.priceCents +
  flavorPrice(r.flavors) +
  r.options.reduce((sum, o) => sum + o.priceCents, 0);

/** "Sem tomate · Pouco cebola · Extra molho". */
export const adjustmentsText = (
  list: { name: string; kind: AdjustmentKind }[],
) =>
  list
    .map((a) => `${adjustmentKindLabel[a.kind]} ${a.name.toLowerCase()}`)
    .join(' · ');

const kinds: AdjustmentKind[] = ['remove', 'less', 'extra'];

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Personalização de um item: ingredientes (Sem/Pouco/Extra, sem custo) e
 * grupos de complementos. Um grupo filho aparece logo abaixo da opção que o
 * abriu e só é exigido enquanto ela estiver marcada.
 */
export function OptionPicker({
  product,
  groups,
  allGroups,
  pizza,
  initial,
  confirmLabel = 'Adicionar',
  onClose,
  onConfirm,
}: {
  product: Product | null;
  /** Grupos do produto (categoria + produto, sem os desligados). */
  groups: OptionGroup[];
  /** Todos os grupos ativos, para achar os filhos. */
  allGroups: OptionGroup[];
  /** Faixas e sabores; usados quando o produto é tamanho de pizza. */
  pizza?: PizzaMenu;
  initial?: PickerResult;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (result: PickerResult) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjust, setAdjust] = useState<Record<string, AdjustmentKind>>({});
  const [flavors, setFlavors] = useState<ChosenFlavor[]>([]);
  const [flavorSearch, setFlavorSearch] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!product) return;
    setFlavors(initial?.flavors ?? []);
    setFlavorSearch('');
    setSelected(new Set(initial?.options.map((o) => o.optionId)));
    setAdjust(
      Object.fromEntries(
        (initial?.adjustments ?? []).map((a) => [a.ingredientId, a.kind]),
      ),
    );
    setQuantity(initial?.quantity ?? 1);
    setNotes(initial?.notes ?? '');
  }, [product, initial]);

  if (!product) return null;

  const groupById = new Map(allGroups.map((g) => [g.id, g]));
  // Obrigatórios primeiro: o garçom resolve o que trava o pedido antes dos extras.
  const topLevel = [...groups].sort(
    (a, b) => Number(b.minSelect > 0) - Number(a.minSelect > 0),
  );

  /** Grupos ativos na ordem de exibição, com o nível de cada um. */
  const active: { group: OptionGroup; depth: number }[] = [];
  const visit = (group: OptionGroup, depth: number) => {
    if (depth > 3 || active.some((a) => a.group.id === group.id)) return;
    active.push({ group, depth });
    for (const o of group.options) {
      const child = o.childGroupId && groupById.get(o.childGroupId);
      if (child && selected.has(o.id)) visit(child, depth + 1);
    }
  };
  for (const g of topLevel) visit(g, 0);

  const countIn = (g: OptionGroup) =>
    g.options.filter((o) => selected.has(o.id)).length;

  function toggle(group: OptionGroup, optionId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }
      if (group.maxSelect === 1) {
        for (const o of group.options) next.delete(o.id);
      } else if (countIn(group) >= group.maxSelect) {
        return s;
      }
      next.add(optionId);
      return next;
    });
  }

  // Só contam as opções de grupos ativos (desmarcar o combo descarta a bebida).
  const chosen: ChosenOption[] = active.flatMap(({ group }) =>
    group.options
      .filter((o) => selected.has(o.id))
      .map((o) => ({
        optionId: o.id,
        groupName: group.name,
        name: o.name,
        priceCents: o.priceCents,
      })),
  );
  const adjustable = product.ingredients.filter((i) => i.adjustable);
  const adjustments: ChosenAdjustment[] = adjustable
    .filter((i) => adjust[i.ingredientId])
    .map((i) => ({
      ingredientId: i.ingredientId,
      name: i.name,
      kind: adjust[i.ingredientId],
    }));
  const maxFlavors = product.maxFlavors ?? 0;
  const tiersHere = maxFlavors ? flavorsForSize(pizza, product.id) : [];
  const term = normalize(flavorSearch.trim());
  const flavorMatches = (f: PizzaFlavor) =>
    !term ||
    normalize(f.name).includes(term) ||
    normalize(f.description ?? '').includes(term);

  function toggleFlavor(f: PizzaFlavor, tierName: string, priceCents: number) {
    setFlavors((list) => {
      if (list.some((x) => x.flavorId === f.id))
        return list.filter((x) => x.flavorId !== f.id);
      const chosenFlavor = {
        flavorId: f.id,
        name: f.name,
        tierName,
        priceCents,
      };
      if (maxFlavors === 1) return [chosenFlavor];
      return list.length >= maxFlavors ? list : [...list, chosenFlavor];
    });
  }

  const unitPrice = unitPriceOf(product, { options: chosen, flavors });
  const missingText =
    maxFlavors && flavors.length === 0
      ? 'Escolha o sabor'
      : (() => {
          const g = active.find(
            ({ group }) => countIn(group) < group.minSelect,
          )?.group;
          return g ? `Escolha: ${g.name}` : null;
        })();
  const recipe = product.ingredients.map((i) => i.name).join(', ');
  const fromPrice = tiersHere.length
    ? Math.min(...tiersHere.map((t) => t.priceCents))
    : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{product.name}</DialogTitle>
          <DialogDescription>
            {maxFlavors
              ? `${maxFlavors === 1 ? '1 sabor' : `até ${maxFlavors} sabores`} · a partir de ${formatCents(product.priceCents + fromPrice)} · cobra o sabor mais caro`
              : formatCents(product.priceCents)}
            {(recipe || product.description) &&
              ` · ${recipe || product.description}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {maxFlavors > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Sabores</h3>
                <Badge
                  variant={flavors.length === 0 ? 'default' : 'secondary'}
                  className={cn(flavors.length > 0 && 'text-free')}
                >
                  {flavors.length === 0
                    ? maxFlavors === 1
                      ? 'Escolha 1'
                      : `Escolha até ${maxFlavors}`
                    : `${flavors.length}/${maxFlavors}`}
                </Badge>
              </div>
              {flavors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {flavors.map((f) => (
                    <Badge key={f.flavorId} variant="outline" className="gap-1">
                      {flavors.length > 1 && (
                        <span className="text-muted-foreground">
                          1/{flavors.length}
                        </span>
                      )}
                      {f.name}
                    </Badge>
                  ))}
                </div>
              )}
              {tiersHere.reduce((n, t) => n + t.flavors.length, 0) > 8 && (
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar sabor ou ingrediente"
                    className="pl-9"
                    value={flavorSearch}
                    onChange={(e) => setFlavorSearch(e.target.value)}
                  />
                </div>
              )}
              {tiersHere.length === 0 && (
                <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                  Nenhum sabor com preço neste tamanho. Ajuste na Pizzaria.
                </p>
              )}
              {tiersHere.map(({ tier, priceCents, flavors: list }) => {
                const shown = list.filter(flavorMatches);
                if (shown.length === 0) return null;
                return (
                  <div key={tier.id} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      <span>{tier.name}</span>
                      <span className="tabular">
                        {formatCents(product.priceCents + priceCents)}
                      </span>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {shown.map((f) => {
                        const index = flavors.findIndex(
                          (x) => x.flavorId === f.id,
                        );
                        const on = index >= 0;
                        const full =
                          maxFlavors > 1 && flavors.length >= maxFlavors;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            disabled={!f.available || (!on && full)}
                            aria-pressed={on}
                            onClick={() =>
                              toggleFlavor(f, tier.name, priceCents)
                            }
                            className={cn(
                              'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition',
                              'hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
                              on && 'border-primary bg-primary/10',
                            )}
                          >
                            <span
                              className={cn(
                                'mt-0.5 grid size-4 shrink-0 place-items-center border text-[10px] font-semibold',
                                maxFlavors === 1 ? 'rounded-full' : 'rounded',
                                on &&
                                  'border-primary bg-primary text-primary-foreground',
                              )}
                            >
                              {on &&
                                (maxFlavors === 1 ? (
                                  <Check className="size-3" />
                                ) : (
                                  index + 1
                                ))}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {f.name}
                              </span>
                              {f.description && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {f.description}
                                </span>
                              )}
                            </span>
                            {!f.available && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                em falta
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {adjustable.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Ingredientes</h3>
                <Badge variant="secondary">sem custo</Badge>
              </div>
              <ul className="space-y-1.5">
                {adjustable.map((i) => (
                  <li
                    key={i.ingredientId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className={cn(
                        'min-w-0 truncate text-sm',
                        adjust[i.ingredientId] === 'remove' &&
                          'text-muted-foreground line-through',
                      )}
                    >
                      {i.name}
                    </span>
                    <div className="flex shrink-0 rounded-md border p-0.5">
                      {kinds.map((kind) => {
                        const on = adjust[i.ingredientId] === kind;
                        return (
                          <button
                            key={kind}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setAdjust((a) => {
                                const next = { ...a };
                                if (on) delete next[i.ingredientId];
                                else next[i.ingredientId] = kind;
                                return next;
                              })
                            }
                            className={cn(
                              'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent',
                              on &&
                                (kind === 'remove'
                                  ? 'bg-destructive/15 text-destructive'
                                  : 'bg-primary/15 text-primary'),
                            )}
                          >
                            {adjustmentKindLabel[kind]}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {active.map(({ group: g, depth }) => {
            const count = countIn(g);
            const full = count >= g.maxSelect && g.maxSelect > 1;
            const pending = count < g.minSelect;
            return (
              <section
                key={g.id}
                className={cn(
                  'space-y-2',
                  depth > 0 && '-mt-2 ml-2 border-l-2 border-primary/40 pl-3',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{g.name}</h3>
                  <Badge
                    variant={pending ? 'default' : 'secondary'}
                    className={cn(!pending && g.minSelect > 0 && 'text-free')}
                  >
                    {pending && g.minSelect > 0
                      ? ruleLabel(g)
                      : g.maxSelect > 1
                        ? `${count}/${g.maxSelect}`
                        : g.minSelect > 0
                          ? 'Ok'
                          : 'Opcional'}
                  </Badge>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {g.options.map((o) => {
                    const on = selected.has(o.id);
                    const disabled = !o.available || (!on && full);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggle(g, o.id)}
                        aria-pressed={on}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition',
                          'hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
                          on && 'border-primary bg-primary/10',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-4 shrink-0 place-items-center border',
                            g.maxSelect === 1 ? 'rounded-full' : 'rounded',
                            on &&
                              'border-primary bg-primary text-primary-foreground',
                          )}
                        >
                          {on && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {o.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular">
                          {!o.available
                            ? 'em falta'
                            : o.priceCents
                              ? `+${formatCents(o.priceCents)}`
                              : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <Input
            maxLength={300}
            placeholder="Observação (ex.: capricha no molho)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t p-4 sm:justify-between">
          {!product.allowFractional ? (
            <div className="flex items-center rounded-md border">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Diminuir"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => q - 1)}
              >
                <Minus />
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular">
                {quantity}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Aumentar"
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus />
              </Button>
            </div>
          ) : (
            <span />
          )}
          <Button
            size="lg"
            className="flex-1 sm:flex-none"
            disabled={!!missingText}
            onClick={() =>
              onConfirm({
                options: chosen,
                adjustments,
                flavors,
                quantity,
                notes: notes.trim(),
              })
            }
          >
            {missingText ??
              `${confirmLabel} · ${formatCents(Math.round(unitPrice * quantity))}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
