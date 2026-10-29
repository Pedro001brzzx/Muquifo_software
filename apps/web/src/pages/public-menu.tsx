import {
  formatCents,
  type PublicMenu,
  type PublicMenuItem,
} from '@muquifo/contracts';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Search, UtensilsCrossed, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, queryKeys } from '@/api';
import { FigureTile } from '@/components/figure-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { figureOf, kindFigure, kindOfCategory } from '@/lib/figures';
import { tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

type Tier = PublicMenu['pizzaTiers'][number];

/** Faixas com preço neste tamanho, para "a partir de". */
const pizzaPrices = (item: PublicMenuItem, tiers: Tier[]) =>
  tiers
    .map((t) => t.prices.find((p) => p.productId === item.id)?.priceCents)
    .filter((p): p is number => p !== undefined)
    .map((p) => item.priceCents + p);

/** "Pizza grande" → "Grande". */
const sizeLabel = (name: string) => {
  const s = name.replace(/^pizza\s+/i, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Tamanhos de pizza do menor para o maior (P, M, G); o resto mantém a ordem. */
const bySize = (a: PublicMenuItem, b: PublicMenuItem) =>
  a.maxFlavors !== null && b.maxFlavors !== null
    ? a.maxFlavors - b.maxFlavors
    : 0;

/** Categoria no topo da tela enquanto o cliente rola, para destacar o atalho. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    const els = key
      .split(',')
      .map((id) => document.getElementById(`cat-${id}`))
      .filter((el) => el !== null);
    if (els.length === 0) return;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        // A primeira na ordem da página entre as que cruzam a faixa de cima.
        const first = els.find((el) => visible.has(el));
        if (first) setActive(first.id.slice('cat-'.length));
      },
      // Faixa logo abaixo da barra fixa de busca e atalhos.
      { rootMargin: '-140px 0px -55% 0px' },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [key]);
  return active;
}

/**
 * Cardápio do cliente, aberto pelo QR code da mesa. Só leitura: o pedido
 * continua com o garçom. Atualiza sozinho (esgotados somem na hora).
 */
export function PublicMenuPage() {
  const [params] = useSearchParams();
  const mesa = Number(params.get('mesa')) || null;
  const menu = useQuery({
    queryKey: queryKeys.publicMenu,
    queryFn: api.publicMenu,
    refetchInterval: 60_000,
  });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{
    item: PublicMenuItem;
    category: string;
  } | null>(null);

  const term = normalize(search.trim());
  const sections = useMemo(
    () =>
      (menu.data?.categories ?? [])
        .map((c) => ({
          ...c,
          items: [...c.items]
            .sort(bySize)
            .filter(
              (i) =>
                !term ||
                normalize(i.name).includes(term) ||
                normalize(i.description ?? '').includes(term) ||
                i.ingredients.some((g) => normalize(g).includes(term)),
            ),
        }))
        .filter((c) => c.items.length > 0),
    [menu.data, term],
  );
  const tiers = menu.data?.pizzaTiers ?? [];
  const restaurant = menu.data?.restaurant;
  const active = useActiveSection(sections.map((c) => c.id));
  const navRef = useRef<HTMLElement>(null);

  // Mantém o atalho da categoria atual visível na barra (rolagem só horizontal).
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>('[aria-current]');
    if (!nav || !chip) return;
    nav.scrollTo({
      left: chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2,
      behavior: 'smooth',
    });
  }, [active]);

  // O atalho do app é para a equipe: o cliente que "adicionar à tela
  // inicial" não pode ganhar um ícone que abre o sistema do restaurante.
  useEffect(() => {
    document.querySelector('link[rel="manifest"]')?.remove();
  }, []);

  useEffect(() => {
    document.title = restaurant?.name
      ? `${restaurant.name} · Cardápio`
      : 'Cardápio';
  }, [restaurant?.name]);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-2xl px-4 pt-5 pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
              {!restaurant?.name && (
                <UtensilsCrossed className="size-6 shrink-0 text-primary" />
              )}
              {restaurant?.name || 'Cardápio'}
            </h1>
            {restaurant?.tagline && (
              <p className="mt-0.5 text-muted-foreground">
                {restaurant.tagline}
              </p>
            )}
          </div>
          {mesa && (
            <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">
              Mesa {tableLabel(mesa)}
            </span>
          )}
        </div>
        {restaurant?.notice && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-busy/40 bg-busy/10 px-3 py-2 text-sm">
            <Megaphone className="mt-0.5 size-4 shrink-0 text-busy" />
            {restaurant.notice}
          </p>
        )}
      </div>

      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-2xl space-y-3 px-4 pt-3 pb-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Procurar no cardápio"
              className="h-11 pl-9 text-base md:text-base"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!term && sections.length > 1 && (
            <nav
              ref={navRef}
              className="relative -mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {sections.map((c) => (
                <a
                  key={c.id}
                  href={`#cat-${c.id}`}
                  aria-current={c.id === active ? 'true' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent',
                    c.id === active &&
                      'border-primary bg-primary text-primary-foreground hover:bg-primary',
                  )}
                >
                  <span aria-hidden>{kindFigure[kindOfCategory(c.name)]}</span>
                  {c.name}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 py-5 pb-24">
        {menu.isError && menu.data && (
          <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" />
            Sem conexão agora. Os preços podem estar desatualizados.
          </p>
        )}
        {menu.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : !menu.data ? (
          <p className="py-12 text-center text-muted-foreground">
            Não foi possível abrir o cardápio. Confira o Wi-Fi e tente de novo.
          </p>
        ) : sections.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            {term ? 'Nada encontrado.' : 'Cardápio em preparação.'}
          </p>
        ) : (
          sections.map((c) => {
            const isPizza = c.items.some((i) => i.maxFlavors !== null);
            return (
              <section
                key={c.id}
                id={`cat-${c.id}`}
                className="scroll-mt-32 space-y-3"
              >
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <span aria-hidden>{kindFigure[kindOfCategory(c.name)]}</span>
                  {c.name}
                </h2>
                <ul className="space-y-2">
                  {c.items.map((item) => {
                    const prices = item.maxFlavors
                      ? pizzaPrices(item, tiers)
                      : [];
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setOpen({ item, category: c.name })}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition active:scale-[0.99]',
                            !item.available && 'opacity-55',
                          )}
                        >
                          <FigureTile
                            emoji={figureOf(item, c.name)}
                            size="lg"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">
                              {item.name}
                            </span>
                            <span className="line-clamp-2 text-sm text-muted-foreground">
                              {item.maxFlavors
                                ? item.maxFlavors === 1
                                  ? '1 sabor'
                                  : `Até ${item.maxFlavors} sabores · cobra o mais caro`
                                : item.description ||
                                  item.ingredients.join(', ')}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            {!item.available ? (
                              <span className="text-sm font-medium text-muted-foreground">
                                Esgotado
                              </span>
                            ) : item.maxFlavors ? (
                              prices.length > 0 && (
                                <>
                                  <span className="block text-xs text-muted-foreground">
                                    a partir de
                                  </span>
                                  <span className="font-semibold tabular">
                                    {formatCents(Math.min(...prices))}
                                  </span>
                                </>
                              )
                            ) : (
                              <span className="font-semibold tabular">
                                {formatCents(item.priceCents)}
                                {item.allowFractional && (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    /kg
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {isPizza && !term && (
                  <PizzaFlavors
                    sizes={c.items.filter((i) => i.maxFlavors !== null)}
                    tiers={tiers}
                  />
                )}
              </section>
            );
          })
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-4 py-3 text-center text-sm text-muted-foreground backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        Para pedir, chame o garçom
        {mesa ? ` e diga “mesa ${tableLabel(mesa)}”` : ''}.
      </footer>

      <ItemDialog entry={open} tiers={tiers} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Tabela de sabores por faixa, com o preço em cada tamanho. */
function PizzaFlavors({
  sizes,
  tiers,
}: {
  sizes: PublicMenuItem[];
  tiers: Tier[];
}) {
  const shown = tiers.filter((t) => t.flavors.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
      <h3 className="text-lg font-semibold">Sabores</h3>
      {shown.map((t) => (
        <div key={t.id} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-1.5">
            <span className="font-semibold">{t.name}</span>
            <span className="text-sm text-muted-foreground tabular">
              {sizes
                .map((s) => {
                  const p = t.prices.find((x) => x.productId === s.id);
                  return p
                    ? `${sizeLabel(s.name)} ${formatCents(s.priceCents + p.priceCents)}`
                    : null;
                })
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <ul className="space-y-1.5">
            {t.flavors.map((f) => (
              <li
                key={f.name}
                className={cn(!f.available && 'text-muted-foreground')}
              >
                <span className="font-medium">{f.name}</span>
                {!f.available && <span className="text-xs"> · em falta</span>}
                {f.description && (
                  <span className="block text-sm text-muted-foreground">
                    {f.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ItemDialog({
  entry,
  tiers,
  onClose,
}: {
  entry: { item: PublicMenuItem; category: string } | null;
  tiers: Tier[];
  onClose: () => void;
}) {
  if (!entry) return null;
  const { item, category } = entry;
  const prices = item.maxFlavors ? pizzaPrices(item, tiers) : [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <FigureTile emoji={figureOf(item, category)} size="xl" />
          <DialogTitle className="text-xl">{item.name}</DialogTitle>
          <DialogDescription className="text-lg font-semibold text-foreground tabular">
            {!item.available
              ? 'Esgotado no momento'
              : item.maxFlavors
                ? prices.length
                  ? `de ${formatCents(Math.min(...prices))} a ${formatCents(Math.max(...prices))}`
                  : ''
                : formatCents(item.priceCents)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {item.description && (
            <p className="text-muted-foreground">{item.description}</p>
          )}
          {item.ingredients.length > 0 && (
            <div>
              <h4 className="font-medium">Ingredientes</h4>
              <p className="text-muted-foreground">
                {item.ingredients.join(', ')}
              </p>
            </div>
          )}
          {item.maxFlavors && (
            <p className="text-muted-foreground">
              {item.maxFlavors === 1
                ? 'Escolha 1 sabor.'
                : `Escolha até ${item.maxFlavors} sabores. Com mais de um, vale o preço do sabor mais caro.`}
            </p>
          )}
          {item.extras
            .filter((e) => e.options.length > 0)
            .map((e) => (
              <div key={e.name}>
                <h4 className="font-medium">
                  {e.name}
                  <span className="font-normal text-muted-foreground">
                    {e.required ? ' · escolha 1' : ' · opcional'}
                  </span>
                </h4>
                <ul className="mt-1 space-y-0.5">
                  {e.options.map((o) => (
                    <li
                      key={o.name}
                      className="flex justify-between gap-3 text-muted-foreground"
                    >
                      <span>{o.name}</span>
                      {o.priceCents > 0 && (
                        <span className="tabular">
                          + {formatCents(o.priceCents)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
