import {
  errorCodes,
  formatCents,
  type Product,
  parseCents,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { FigurePicker, FigureTile } from '@/components/figure-picker';
import { Field } from '@/components/form-dialog';
import { PageBody, PageHeader } from '@/components/layout';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { EmptyState } from '@/components/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toastError } from '@/lib/errors';
import { figureOf, kindFigure, kindOfCategory } from '@/lib/figures';
import { cn } from '@/lib/utils';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Cardápio no modo simples: cartões com figura, preço e "Tem hoje".
 * Tocar num cartão muda nome, figura e preço; o resto fica no modo completo.
 */
export function SimpleMenu({ onComplete }: { onComplete: () => void }) {
  const qc = useQueryClient();
  const products = useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
  });
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);

  const toggle = useMutation({
    mutationFn: (p: Product) =>
      api.updateProduct(p.id, { version: p.version, available: !p.available }),
    onSuccess: (p) =>
      toast.success(
        p.available ? `${p.name} voltou` : `${p.name} marcado como acabou`,
      ),
    onError: toastError,
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.products }),
  });

  const term = normalize(search.trim());
  const active = (products.data ?? []).filter((p) => p.active);
  const sections = useMemo(
    () =>
      (categories.data ?? [])
        .map((c) => ({
          category: c,
          items: active.filter(
            (p) =>
              p.categoryId === c.id &&
              (!term || normalize(p.name).includes(term)),
          ),
        }))
        .filter((s) => s.items.length > 0),
    [categories.data, active, term],
  );

  return (
    <>
      <PageHeader
        title="Cardápio"
        description="Toque num item para mudar o preço ou tirar do cardápio."
        actions={
          <>
            <Button variant="ghost" onClick={onComplete}>
              <Settings2 /> Modo completo
            </Button>
            <Button variant="outline" asChild>
              <Link to="/comecar">
                <Sparkles /> Cardápio pronto
              </Link>
            </Button>
            <Button size="lg" asChild>
              <Link to="/produtos/novo">
                <Plus /> Adicionar item
              </Link>
            </Button>
          </>
        }
      />
      <PageBody className="space-y-6">
        {active.length > 12 && (
          <div className="relative max-w-md">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Procurar item"
              className="h-11 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {products.isLoading || categories.isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="Seu cardápio está vazio"
            description="Diga o tipo do seu negócio e montamos um cardápio pronto para você ajustar."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" asChild>
                  <Link to="/comecar">
                    <Sparkles /> Montar meu cardápio
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to="/produtos/novo">
                    <Plus /> Um item de cada vez
                  </Link>
                </Button>
              </div>
            }
          />
        ) : sections.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Nenhum item encontrado.
          </p>
        ) : (
          sections.map(({ category, items }) => (
            <section key={category.id} className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <span aria-hidden>
                  {kindFigure[kindOfCategory(category.name)]}
                </span>
                {category.name}
                <span className="text-sm font-normal text-muted-foreground">
                  {items.length}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {items.map((p) => (
                  <article
                    key={p.id}
                    className={cn(
                      'flex flex-col overflow-hidden rounded-2xl border bg-card transition',
                      !p.available && 'opacity-60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="flex flex-1 flex-col items-center gap-2 p-3 text-center hover:bg-accent/40 active:scale-[0.99]"
                    >
                      <FigureTile
                        emoji={figureOf(p, category.name)}
                        size="lg"
                      />
                      <span className="line-clamp-2 leading-snug font-medium">
                        {p.name}
                      </span>
                      <span className="text-sm text-muted-foreground tabular">
                        {p.maxFlavors
                          ? 'preço pelo sabor'
                          : formatCents(p.priceCents)}
                      </span>
                    </button>
                    <label className="flex cursor-pointer items-center justify-between gap-2 border-t px-3 py-2 text-sm">
                      <span
                        className={cn(
                          'font-medium',
                          p.available ? 'text-free' : 'text-muted-foreground',
                        )}
                      >
                        {p.available ? 'Tem hoje' : 'Acabou'}
                      </span>
                      <Switch
                        checked={p.available}
                        disabled={
                          toggle.isPending && toggle.variables?.id === p.id
                        }
                        aria-label={`${p.name} tem hoje`}
                        onCheckedChange={() => toggle.mutate(p)}
                      />
                    </label>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </PageBody>

      <SimpleEditDialog
        product={editing}
        categoryName={
          categories.data?.find((c) => c.id === editing?.categoryId)?.name
        }
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function SimpleEditDialog({
  product,
  categoryName,
  onClose,
}: {
  product: Product | null;
  categoryName?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [figure, setFigure] = useState('');
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setPriceText(centsToInput(product.priceCents));
    setFigure(figureOf(product, categoryName));
    setConfirmRemove(false);
    setError('');
  }, [product, categoryName]);

  const save = useMutation({
    mutationFn: (changes: {
      name?: string;
      priceCents?: number;
      icon?: string;
      active?: boolean;
    }) =>
      api.updateProduct(product!.id, { version: product!.version, ...changes }),
    onSuccess: (p, changes) => {
      toast.success(
        changes.active === false
          ? `${p.name} saiu do cardápio`
          : `${p.name} salvo`,
      );
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === errorCodes.conflict)
        return setError(e.message);
      toastError(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.products }),
  });

  if (!product) return null;
  const isPizza = product.maxFlavors !== null;

  function submit() {
    const cents = parseCents(priceText);
    if (!name.trim()) return setError('Escreva o nome.');
    if (!isPizza && (cents === null || cents <= 0))
      return setError('Escreva o preço.');
    save.mutate({
      name: name.trim(),
      icon: figure,
      ...(isPizza ? {} : { priceCents: cents ?? 0 }),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mudar item</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-label="Trocar figura"
              onClick={() => setPicking(true)}
              className="rounded-3xl transition active:scale-95"
            >
              <FigureTile emoji={figure} size="xl" />
            </button>
            <button
              type="button"
              className="text-sm text-primary underline-offset-2 hover:underline"
              onClick={() => setPicking(true)}
            >
              Trocar figura
            </button>
          </div>
          <Field label="Nome" htmlFor="simple-name">
            <Input
              id="simple-name"
              className="h-12 text-lg md:text-lg"
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
            />
          </Field>
          {isPizza ? (
            <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              O preço da pizza vem do sabor. Para mudar, abra{' '}
              <Link to="/produtos/pizzaria" className="text-primary underline">
                Pizzaria
              </Link>
              .
            </p>
          ) : (
            <Field label="Preço" htmlFor="simple-price">
              <MoneyInput
                id="simple-price"
                className="h-14 text-2xl md:text-2xl"
                value={priceText}
                onChange={(v) => {
                  setPriceText(v);
                  setError('');
                }}
              />
            </Field>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full text-base"
            disabled={save.isPending}
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </form>
        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            variant={confirmRemove ? 'destructive' : 'ghost'}
            className={cn(!confirmRemove && 'text-destructive')}
            disabled={save.isPending}
            onClick={() =>
              confirmRemove
                ? save.mutate({ active: false })
                : setConfirmRemove(true)
            }
          >
            {confirmRemove ? 'Toque de novo para tirar' : 'Tirar do cardápio'}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={
                isPizza
                  ? '/produtos/pizzaria'
                  : `/produtos/${product.id}/montar`
              }
            >
              <SlidersHorizontal /> Mais opções
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
      <FigurePicker
        open={picking}
        value={figure}
        onClose={() => setPicking(false)}
        onPick={setFigure}
      />
    </Dialog>
  );
}
