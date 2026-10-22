import {
  errorCodes,
  flavorsText,
  type OptionGroup,
  type Order,
  type OrderChannel,
  type Product,
  type TabDetail,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListPlus,
  Loader2,
  MessageSquarePlus,
  Minus,
  Plus,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { FigureTile } from '@/components/figure-picker';
import {
  adjustmentsText,
  type ChosenAdjustment,
  type ChosenFlavor,
  type ChosenOption,
  flavorsForSize,
  OptionPicker,
  type PickerResult,
  type PizzaMenu,
  unitPriceOf,
} from '@/components/option-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { toastError } from '@/lib/errors';
import { figureOf, kindFigure, kindOfCategory } from '@/lib/figures';
import { formatCents, formatQuantity, tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface CartLine {
  key: number;
  product: Product;
  options: ChosenOption[];
  adjustments: ChosenAdjustment[];
  flavors: ChosenFlavor[];
  /** Produto + sabor + complementos, como o garçom viu; vai como expectedUnitPriceCents. */
  unitPriceCents: number;
  quantity: number;
  notes: string;
  showNotes: boolean;
  /** `blocking`: a linha precisa sair do carrinho antes de enviar. */
  problem?: { text: string; blocking: boolean };
}

/** Identidade da personalização: mesmos sabores, opções e ajustes somam na mesma linha. */
const lineKey = (
  l: Pick<PickerResult, 'options' | 'adjustments' | 'flavors'>,
) =>
  [
    ...l.flavors.map((f) => `f:${f.flavorId}`),
    ...l.options.map((o) => o.optionId),
    ...l.adjustments.map((a) => `${a.ingredientId}:${a.kind}`),
  ]
    .sort()
    .join();

const channelLabel: Record<Exclude<OrderChannel, 'table'>, string> = {
  counter: 'Balcão',
  pickup: 'Retirada',
  delivery: 'Entrega',
};

let nextKey = 1;

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const lineTotal = (l: CartLine) => Math.round(l.unitPriceCents * l.quantity);

function newLine(product: Product, r: PickerResult): CartLine {
  return {
    key: nextKey++,
    product,
    options: r.options,
    adjustments: r.adjustments,
    flavors: r.flavors,
    unitPriceCents: unitPriceOf(product, r),
    quantity: r.quantity,
    notes: r.notes,
    showNotes: false,
  };
}

export function NewOrderSheet({
  tab,
  open,
  onOpenChange,
  cart,
  setCart,
}: {
  tab: TabDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartLine[];
  setCart: (update: (lines: CartLine[]) => CartLine[]) => void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const products = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.products(),
    refetchInterval: open ? 15_000 : false,
  });
  const optionGroups = useQuery({
    queryKey: queryKeys.optionGroups,
    queryFn: () => api.optionGroups(),
    refetchInterval: open ? 15_000 : false,
  });
  const pizzaTiers = useQuery({
    queryKey: queryKeys.pizzaTiers,
    queryFn: () => api.pizzaTiers(),
    refetchInterval: open ? 15_000 : false,
  });
  const pizzaFlavors = useQuery({
    queryKey: queryKeys.pizzaFlavors,
    queryFn: () => api.pizzaFlavors(),
    refetchInterval: open ? 15_000 : false,
  });
  const pizza: PizzaMenu = {
    tiers: pizzaTiers.data ?? [],
    flavors: pizzaFlavors.data ?? [],
  };
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [picking, setPicking] = useState<Product | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [channel, setChannel] = useState<OrderChannel>(
    tab.tableId ? 'table' : 'counter',
  );

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return (products.data ?? []).filter(
      (p) =>
        (category === 'all' || p.categoryId === category) &&
        (!term || normalize(p.name).includes(term)),
    );
  }, [products.data, category, search]);

  const categoryName = new Map(categories.data?.map((c) => [c.id, c.name]));
  const usedCategories = (categories.data ?? []).filter((c) =>
    products.data?.some((p) => p.categoryId === c.id),
  );
  const total = cart.reduce((sum, l) => sum + lineTotal(l), 0);
  const count = cart.reduce(
    (sum, l) => sum + (l.product.allowFractional ? 1 : l.quantity),
    0,
  );

  const updateLine = (key: number, patch: Partial<CartLine>) =>
    setCart((lines) =>
      lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );

  /** Grupos do produto: os da categoria (menos os desligados) e depois os dele. */
  function groupsFor(product: Product): OptionGroup[] {
    const fromCategory = (
      categories.data?.find((c) => c.id === product.categoryId)
        ?.optionGroupIds ?? []
    ).filter((id) => !product.excludedOptionGroupIds.includes(id));
    const byId = new Map(optionGroups.data?.map((g) => [g.id, g]));
    return [...new Set([...fromCategory, ...product.optionGroupIds])]
      .map((id) => byId.get(id))
      .filter((g): g is OptionGroup => !!g);
  }

  const customizable = (product: Product) =>
    !!product.maxFlavors ||
    groupsFor(product).length > 0 ||
    product.ingredients.some((i) => i.adjustable);

  /** Pizza: menor preço entre as faixas com sabor neste tamanho. */
  const pizzaFrom = (product: Product) => {
    const prices = flavorsForSize(pizza, product.id).map((t) => t.priceCents);
    return prices.length ? product.priceCents + Math.min(...prices) : null;
  };

  /** Um toque adiciona; só abre a escolha se houver sabor ou grupo obrigatório. */
  function add(product: Product) {
    if (product.maxFlavors || groupsFor(product).some((g) => g.minSelect > 0))
      setPicking(product);
    else
      addLine(product, {
        options: [],
        adjustments: [],
        flavors: [],
        quantity: 1,
        notes: '',
      });
  }

  function addLine(product: Product, r: PickerResult) {
    setCart((lines) => {
      // Mesmo produto com a mesma personalização soma na linha existente.
      const same = lines.find(
        (l) =>
          l.product.id === product.id &&
          lineKey(l) === lineKey(r) &&
          !l.notes &&
          !r.notes &&
          !product.allowFractional &&
          !l.problem,
      );
      if (same) {
        return lines.map((l) =>
          l === same ? { ...l, quantity: l.quantity + r.quantity } : l,
        );
      }
      return [...lines, newLine(product, r)];
    });
  }

  /** Troca a personalização de uma linha (botão Personalizar no carrinho). */
  function replaceLine(key: number, r: PickerResult) {
    setCart((lines) =>
      lines.map((l) => (l.key === key ? { ...newLine(l.product, r), key } : l)),
    );
  }

  /** Recalcula o preço das linhas do produto com o cardápio atualizado. */
  async function repriceLines(productId: string) {
    const [freshProducts, freshGroups, freshTiers] = await Promise.all([
      qc.fetchQuery({
        queryKey: queryKeys.products,
        queryFn: () => api.products(),
      }),
      qc.fetchQuery({
        queryKey: queryKeys.optionGroups,
        queryFn: () => api.optionGroups(),
      }),
      qc.fetchQuery({
        queryKey: queryKeys.pizzaTiers,
        queryFn: () => api.pizzaTiers(),
      }),
    ]);
    const product = freshProducts.find((p) => p.id === productId);
    const optionPrice = new Map(
      freshGroups.flatMap((g) => g.options.map((o) => [o.id, o.priceCents])),
    );
    const tierPrice = new Map(
      freshTiers.map((t) => [
        t.name,
        t.prices.find((p) => p.productId === productId)?.priceCents,
      ]),
    );
    setCart((lines) =>
      lines.map((l) => {
        if (l.product.id !== productId || !product) return l;
        const options = l.options.map((o) => ({
          ...o,
          priceCents: optionPrice.get(o.optionId) ?? o.priceCents,
        }));
        const flavors = l.flavors.map((f) => ({
          ...f,
          priceCents: tierPrice.get(f.tierName) ?? f.priceCents,
        }));
        const unit = unitPriceOf(product, { options, flavors });
        return unit === l.unitPriceCents
          ? l
          : {
              ...l,
              product,
              options,
              flavors,
              unitPriceCents: unit,
              problem: {
                text: `Preço mudou de ${formatCents(l.unitPriceCents)} para ${formatCents(unit)}`,
                blocking: false,
              },
            };
      }),
    );
  }

  function step(line: CartLine, delta: number) {
    const quantity = line.quantity + delta;
    if (quantity <= 0) setCart((ls) => ls.filter((l) => l.key !== line.key));
    else updateLine(line.key, { quantity });
  }

  const send = useMutation({
    mutationFn: (submit: boolean) =>
      api.createOrder({
        tabId: tab.id,
        channel,
        submit,
        items: cart.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
          notes: l.notes.trim() || null,
          optionIds: l.options.map((o) => o.optionId),
          adjustments: l.adjustments.map((a) => ({
            ingredientId: a.ingredientId,
            kind: a.kind,
          })),
          flavorIds: l.flavors.map((f) => f.flavorId),
          expectedUnitPriceCents: l.unitPriceCents,
        })),
      }),
    onSuccess: (order: Order, submit) => {
      void qc.invalidateQueries({ queryKey: ['tab', tab.id] });
      void qc.invalidateQueries({ queryKey: ['tabs'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
      toast.success(
        submit
          ? `Pedido #${order.number} enviado para produção`
          : `Pedido #${order.number} salvo como rascunho`,
        { description: formatCents(order.totalCents) },
      );
      setCart(() => []);
      setSearch('');
      onOpenChange(false);
    },
    onError: (error) => {
      // A API recusa o pedido inteiro; marcamos a linha para o garçom revisar.
      const details = (
        error instanceof ApiRequestError ? error.body?.details : undefined
      ) as
        | { productId?: string; optionIds?: string[]; flavorIds?: string[] }
        | undefined;
      const productId = details?.productId;
      if (error instanceof ApiRequestError && productId) {
        const mark = (
          text: string,
          match: (l: CartLine) => boolean = () => true,
        ) =>
          setCart((lines) =>
            lines.map((l) =>
              l.product.id === productId && match(l)
                ? { ...l, problem: { text, blocking: true } }
                : l,
            ),
          );
        if (error.code === errorCodes.priceChanged) {
          void repriceLines(productId);
          toast.warning('Preço alterado no cardápio', {
            description:
              'O carrinho foi atualizado. Confira com o cliente e envie de novo.',
          });
          return;
        }
        if (error.code === errorCodes.productUnavailable) {
          mark('Esgotado — remova para enviar');
          toast.warning(error.message);
          void qc.invalidateQueries({ queryKey: queryKeys.products });
          return;
        }
        if (
          error.code === errorCodes.optionUnavailable ||
          error.code === errorCodes.invalidOptions ||
          error.code === errorCodes.invalidAdjustments
        ) {
          const ids = details?.optionIds;
          mark(
            error.code === errorCodes.optionUnavailable
              ? `${error.message} Remova e lance de novo.`
              : 'Complementos mudaram no cardápio. Remova e lance de novo.',
            ids
              ? (l) => l.options.some((o) => ids.includes(o.optionId))
              : undefined,
          );
          toast.warning(error.message);
          void qc.invalidateQueries({ queryKey: queryKeys.optionGroups });
          return;
        }
        if (
          error.code === errorCodes.flavorUnavailable ||
          error.code === errorCodes.invalidFlavors
        ) {
          const ids = details?.flavorIds;
          mark(
            `${error.message} Remova e lance de novo.`,
            ids
              ? (l) => l.flavors.some((f) => ids.includes(f.flavorId))
              : undefined,
          );
          toast.warning(error.message);
          void qc.invalidateQueries({ queryKey: queryKeys.pizzaFlavors });
          void qc.invalidateQueries({ queryKey: queryKeys.pizzaTiers });
          return;
        }
      }
      toastError(error);
    },
  });

  const blocked = cart.some((l) => l.problem?.blocking);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Novo pedido</SheetTitle>
          <SheetDescription>
            Comanda {tab.code}
            {tab.tableNumber !== null &&
              ` · Mesa ${tableLabel(tab.tableNumber)}`}
            {tab.customerName && ` · ${tab.customerName}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar no cardápio"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ id: 'all', name: 'Tudo' }, ...usedCategories].map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={category === c.id ? 'default' : 'outline'}
                className="shrink-0 rounded-full"
                onClick={() => setCategory(c.id)}
              >
                {c.id !== 'all' && (
                  <span aria-hidden>{kindFigure[kindOfCategory(c.name)]}</span>
                )}
                {c.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {products.isLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum produto encontrado.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {visible.map((p) => {
                const inCart = cart
                  .filter((l) => l.product.id === p.id)
                  .reduce((s, l) => s + l.quantity, 0);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!p.available}
                    onClick={() => add(p)}
                    className={cn(
                      'relative flex min-h-20 flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition active:scale-[0.98]',
                      'hover:border-primary/50 hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
                      inCart > 0 && 'border-primary/60 bg-primary/5',
                    )}
                  >
                    <span className="flex items-start gap-2.5">
                      <FigureTile
                        emoji={figureOf(p, categoryName.get(p.categoryId))}
                        size="md"
                      />
                      <span className="line-clamp-2 pt-0.5 text-sm leading-snug font-medium">
                        {p.name}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-1">
                      <span className="tabular text-sm text-muted-foreground">
                        {p.maxFlavors ? (
                          <>
                            <span className="text-xs">a partir de </span>
                            {formatCents(pizzaFrom(p) ?? p.priceCents)}
                          </>
                        ) : (
                          formatCents(p.priceCents)
                        )}
                        {p.allowFractional && '/kg'}
                        {customizable(p) && (
                          <ListPlus
                            className="ml-1 inline size-3.5 align-[-2px]"
                            aria-label="Tem complementos"
                          />
                        )}
                      </span>
                      {!p.available ? (
                        <Badge variant="secondary">Esgotado</Badge>
                      ) : inCart > 0 ? (
                        <Badge className="tabular">
                          {formatQuantity(inCart)}
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="max-h-[45%] overflow-y-auto border-t bg-muted/30">
          {cart.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-4 py-4 text-sm text-muted-foreground">
              <ShoppingCart className="size-4" /> Carrinho vazio · toque nos
              produtos para adicionar
            </p>
          ) : (
            <ul className="divide-y">
              {cart.map((line) => (
                <li key={line.key} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {line.product.allowFractional ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0.001}
                        step={0.001}
                        aria-label="Quantidade"
                        className="h-8 w-24 tabular"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, {
                            quantity: Math.max(
                              0.001,
                              Number(e.target.value) || 0,
                            ),
                          })
                        }
                      />
                    ) : (
                      <div className="flex items-center rounded-md border bg-background">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Diminuir"
                          onClick={() => step(line, -1)}
                        >
                          {line.quantity === 1 ? <Trash2 /> : <Minus />}
                        </Button>
                        <span className="w-7 text-center text-sm font-semibold tabular">
                          {line.quantity}
                        </span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Aumentar"
                          onClick={() => step(line, 1)}
                        >
                          <Plus />
                        </Button>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {line.product.name}
                      </div>
                      {line.flavors.length > 0 && (
                        <div className="text-xs font-medium">
                          {flavorsText(line.flavors)}
                        </div>
                      )}
                      {line.options.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {line.options.map((o) => o.name).join(', ')}
                        </div>
                      )}
                      {line.adjustments.length > 0 && (
                        <div className="text-xs text-destructive/80">
                          {adjustmentsText(line.adjustments)}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground tabular">
                        {formatCents(line.unitPriceCents)}
                        {line.product.allowFractional ? '/kg' : ' cada'}
                      </div>
                    </div>
                    {customizable(line.product) && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Personalizar ${line.product.name}`}
                        className={cn(
                          (line.options.length > 0 ||
                            line.adjustments.length > 0 ||
                            line.flavors.length > 0) &&
                            'text-primary',
                        )}
                        onClick={() => setEditing(line)}
                      >
                        <SlidersHorizontal />
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Observação"
                      className={cn(line.notes && 'text-primary')}
                      onClick={() =>
                        updateLine(line.key, { showNotes: !line.showNotes })
                      }
                    >
                      <MessageSquarePlus />
                    </Button>
                    <div className="w-20 text-right text-sm font-semibold tabular">
                      {formatCents(lineTotal(line))}
                    </div>
                  </div>
                  {line.showNotes && (
                    <Input
                      autoFocus
                      maxLength={300}
                      placeholder="Observação (ex.: sem cebola)"
                      className="h-8 text-sm"
                      value={line.notes}
                      onChange={(e) =>
                        updateLine(line.key, { notes: e.target.value })
                      }
                    />
                  )}
                  {!line.showNotes && line.notes && (
                    <p className="text-xs text-muted-foreground italic">
                      “{line.notes}”
                    </p>
                  )}
                  {line.problem && (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-busy/10 px-2 py-1 text-xs text-busy">
                      {line.problem.text}
                      {line.problem.blocking ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setCart((ls) =>
                              ls.filter((l) => l.key !== line.key),
                            )
                          }
                        >
                          Remover
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            updateLine(line.key, { problem: undefined })
                          }
                        >
                          Ok
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-3">
            {tab.tableId ? (
              <span className="text-sm text-muted-foreground">
                {count} {count === 1 ? 'item' : 'itens'}
              </span>
            ) : (
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as OrderChannel)}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(channelLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-lg font-semibold tabular">
              {formatCents(total)}
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              variant="outline"
              disabled={cart.length === 0 || send.isPending || blocked}
              onClick={() => send.mutate(false)}
            >
              Salvar rascunho
            </Button>
            <Button
              size="lg"
              disabled={cart.length === 0 || send.isPending || blocked}
              onClick={() => send.mutate(true)}
            >
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Enviar para produção
            </Button>
          </div>
        </div>
        <OptionPicker
          product={picking}
          groups={picking ? groupsFor(picking) : []}
          allGroups={optionGroups.data ?? []}
          pizza={pizza}
          onClose={() => setPicking(null)}
          onConfirm={(result) => {
            if (picking) addLine(picking, result);
            setPicking(null);
          }}
        />
        <OptionPicker
          product={editing?.product ?? null}
          groups={editing ? groupsFor(editing.product) : []}
          allGroups={optionGroups.data ?? []}
          pizza={pizza}
          initial={editing ?? undefined}
          confirmLabel="Salvar"
          onClose={() => setEditing(null)}
          onConfirm={(result) => {
            if (editing) replaceLine(editing.key, result);
            setEditing(null);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
