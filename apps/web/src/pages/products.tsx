import type { Category, OptionGroup, Product } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ChefHat,
  FolderPlus,
  LayoutGrid,
  ListPlus,
  Loader2,
  MoreVertical,
  Package,
  Pencil,
  Pizza as PizzaIcon,
  Plus,
  Scale,
  Search,
  Sparkles,
  Tags,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { PageBody, PageHeader } from '@/components/layout';
import { OptionGroupList } from '@/components/option-group-list';
import { OptionGroupSheet } from '@/components/option-groups';
import { CategoryFormDialog, ProductSheet } from '@/components/product-sheet';
import {
  NewItemDialog,
  QuickAddDialog,
  type QuickKind,
} from '@/components/quick-add';
import { EmptyState } from '@/components/shared';
import { SimpleMenu } from '@/components/simple-menu';
import { StarterKitDialog } from '@/components/starter-kit';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toastError } from '@/lib/errors';
import { formatCents } from '@/lib/format';
import { useMenuMode } from '@/lib/menu-mode';
import { cn } from '@/lib/utils';

type StatusFilter = 'active' | 'soldout' | 'archived';
const ALL = 'all';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Produtos de todos os status, para a administração (o cardápio usa só os ativos). */
function useAdminProducts() {
  return useQuery({
    queryKey: [...queryKeys.products, 'admin'],
    queryFn: () => api.products({ status: 'all' }),
  });
}

/** Modo simples (padrão) ou completo, escolhido neste aparelho. */
export function ProductsPage() {
  const [mode, setMode] = useMenuMode();
  return mode === 'simple' ? (
    <SimpleMenu onComplete={() => setMode('complete')} />
  ) : (
    <CompleteProducts onSimple={() => setMode('simple')} />
  );
}

function CompleteProducts({ onSimple }: { onSimple: () => void }) {
  const [params] = useSearchParams();
  const [section, setSection] = useState(
    params.get('aba') === 'complementos' ? 'options' : 'products',
  );
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [quick, setQuick] = useState<QuickKind | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<Category | 'new' | null>(
    null,
  );
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [kitOpen, setKitOpen] = useState(false);
  const [groupDialog, setGroupDialog] = useState<OptionGroup | 'new' | null>(
    null,
  );
  const products = useAdminProducts();

  const counts = useMemo(() => {
    const list = products.data ?? [];
    return {
      active: list.filter((p) => p.active).length,
      soldout: list.filter((p) => p.active && !p.available).length,
      archived: list.filter((p) => !p.active).length,
    };
  }, [products.data]);

  return (
    <Tabs value={section} onValueChange={setSection}>
      <PageHeader
        title="Produtos"
        description={
          products.data
            ? `${counts.active} no cardápio · ${counts.soldout} esgotados · ${counts.archived} arquivados`
            : 'Cardápio do restaurante.'
        }
        actions={
          section === 'options' ? (
            <>
              <Button variant="outline" onClick={() => setKitOpen(true)}>
                <Sparkles /> Modelo de lanchonete
              </Button>
              <Button onClick={() => setGroupDialog('new')}>
                <Plus /> Novo grupo
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onSimple}>
                <LayoutGrid /> Modo simples
              </Button>
              <Button
                variant="outline"
                onClick={() => setCategoryDialog('new')}
              >
                <FolderPlus /> Categoria
              </Button>
              <Button variant="outline" asChild>
                <Link to="/produtos/pizzaria">
                  <PizzaIcon /> Pizzaria
                </Link>
              </Button>
              <Button onClick={() => setChoosing(true)}>
                <Plus /> Novo item
              </Button>
            </>
          )
        }
      >
        <TabsList>
          <TabsTrigger value="products">
            <Package /> Produtos
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tags /> Categorias
          </TabsTrigger>
          <TabsTrigger value="options">
            <ListPlus /> Complementos
          </TabsTrigger>
        </TabsList>
      </PageHeader>

      <PageBody>
        <TabsContent value="products">
          <ProductList
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            onEdit={setEditing}
            onCreate={() => setChoosing(true)}
          />
        </TabsContent>
        <TabsContent value="categories">
          <CategoryList onEdit={(c) => setCategoryDialog(c)} />
        </TabsContent>
        <TabsContent value="options">
          <OptionGroupList
            onEdit={setGroupDialog}
            onCreate={() => setGroupDialog('new')}
            onKit={() => setKitOpen(true)}
          />
        </TabsContent>
      </PageBody>

      <StarterKitDialog open={kitOpen} onClose={() => setKitOpen(false)} />
      <NewItemDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        onQuick={setQuick}
        onSimple={() => setCreating(true)}
      />
      <QuickAddDialog kind={quick} onClose={() => setQuick(null)} />

      <OptionGroupSheet
        open={groupDialog !== null}
        group={groupDialog === 'new' ? null : groupDialog}
        onClose={() => setGroupDialog(null)}
      />

      <ProductSheet
        open={creating || editing !== null}
        product={editing}
        defaultCategoryId={categoryFilter === ALL ? undefined : categoryFilter}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
      <CategoryFormDialog
        open={categoryDialog !== null}
        category={categoryDialog === 'new' ? null : categoryDialog}
        onClose={() => setCategoryDialog(null)}
      />
    </Tabs>
  );
}

function ProductList({
  categoryFilter,
  setCategoryFilter,
  onEdit,
  onCreate,
}: {
  categoryFilter: string;
  setCategoryFilter: (id: string) => void;
  onEdit: (p: Product) => void;
  onCreate: () => void;
}) {
  const qc = useQueryClient();
  const products = useAdminProducts();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const sectors = useQuery({
    queryKey: queryKeys.sectors,
    queryFn: api.sectors,
  });
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [archiving, setArchiving] = useState<Product | null>(null);

  const update = useMutation({
    mutationFn: ({
      product,
      changes,
    }: {
      product: Product;
      changes: { available?: boolean; active?: boolean };
    }) =>
      api.updateProduct(product.id, { version: product.version, ...changes }),
    onSuccess: (p, { changes }) => {
      toast.success(
        changes.active === false
          ? `${p.name} arquivado`
          : changes.active === true
            ? `${p.name} de volta ao cardápio`
            : p.available
              ? `${p.name} disponível`
              : `${p.name} marcado como esgotado`,
      );
      setArchiving(null);
    },
    onError: toastError,
    // Em conflito de versão também recarrega, para mostrar o estado atual.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.products }),
  });

  const sectorName = new Map(sectors.data?.map((s) => [s.id, s.name]));
  const term = normalize(search.trim());
  const visible = (products.data ?? []).filter(
    (p) =>
      (status === 'archived'
        ? !p.active
        : status === 'soldout'
          ? p.active && !p.available
          : p.active) &&
      (categoryFilter === ALL || p.categoryId === categoryFilter) &&
      (!term ||
        normalize(p.name).includes(term) ||
        p.code?.toLowerCase().includes(term) ||
        normalize(p.description ?? '').includes(term)),
  );
  // Agrupa na ordem do cardápio.
  const groups = (categories.data ?? [])
    .map((c) => ({
      category: c,
      items: visible.filter((p) => p.categoryId === c.id),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-72">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Nome, código ou descrição"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as categorias</SelectItem>
              {categories.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {!c.active && ' (arquivada)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Tabs
          value={status}
          onValueChange={(v) => setStatus(v as StatusFilter)}
        >
          <TabsList>
            <TabsTrigger value="active">No cardápio</TabsTrigger>
            <TabsTrigger value="soldout">Esgotados</TabsTrigger>
            <TabsTrigger value="archived">Arquivados</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {products.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Package}
          title={
            search || categoryFilter !== ALL
              ? 'Nenhum produto encontrado'
              : status === 'archived'
                ? 'Nenhum produto arquivado'
                : status === 'soldout'
                  ? 'Nada esgotado no momento'
                  : 'Cardápio vazio'
          }
          description={
            status === 'active' && !search
              ? 'Cadastre o primeiro produto do cardápio.'
              : undefined
          }
          action={
            status === 'active' &&
            !search && (
              <Button onClick={onCreate}>
                <Plus /> Novo item
              </Button>
            )
          }
        />
      ) : (
        groups.map(({ category, items }) => (
          <section
            key={category.id}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5 md:px-5">
              <h2 className="flex items-center gap-2 font-semibold">
                {category.name}
                {!category.active && <Badge variant="outline">Arquivada</Badge>}
              </h2>
              <span className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? 'produto' : 'produtos'}
              </span>
            </div>
            <div className="hidden grid-cols-[minmax(0,1fr)_140px_110px_130px_40px] gap-4 border-b px-5 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid">
              <span>Produto</span>
              <span>Setor</span>
              <span className="text-right">Preço</span>
              <span className="text-center">Disponível</span>
              <span />
            </div>
            <ul className="divide-y">
              {items.map((p) => (
                <li
                  key={p.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-accent/40 md:grid-cols-[minmax(0,1fr)_140px_110px_130px_40px] md:gap-4 md:px-5"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => onEdit(p)}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate font-medium',
                          (!p.available || !p.active) &&
                            'text-muted-foreground',
                        )}
                      >
                        {p.name}
                      </span>
                      {p.code && (
                        <Badge
                          variant="outline"
                          className="shrink-0 font-mono text-[10px]"
                        >
                          {p.code}
                        </Badge>
                      )}
                      {p.allowFractional && (
                        <Scale
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-label="Vendido por peso"
                        />
                      )}
                    </span>
                    {p.maxFlavors && (
                      <span className="block text-xs text-muted-foreground">
                        Pizza ·{' '}
                        {p.maxFlavors === 1
                          ? '1 sabor'
                          : `até ${p.maxFlavors} sabores`}
                      </span>
                    )}
                    {p.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.description}
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
                      {p.sectorId ? sectorName.get(p.sectorId) : 'Sem setor'}
                    </span>
                  </button>
                  <span className="hidden text-sm text-muted-foreground md:block">
                    {p.sectorId ? sectorName.get(p.sectorId) : '—'}
                  </span>
                  <span className="text-right font-semibold tabular md:order-none">
                    {p.maxFlavors ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {p.priceCents ? `${formatCents(p.priceCents)} + ` : ''}
                        pelo sabor
                      </span>
                    ) : (
                      formatCents(p.priceCents)
                    )}
                    {p.allowFractional && (
                      <span className="text-xs font-normal text-muted-foreground">
                        /kg
                      </span>
                    )}
                  </span>
                  <span className="col-start-2 row-start-2 flex items-center justify-end gap-2 md:col-auto md:row-auto md:justify-center">
                    {p.active ? (
                      <>
                        <span className="text-xs text-muted-foreground md:hidden">
                          {p.available ? 'Disponível' : 'Esgotado'}
                        </span>
                        <Switch
                          checked={p.available}
                          disabled={
                            update.isPending &&
                            update.variables?.product.id === p.id
                          }
                          onCheckedChange={(available) =>
                            update.mutate({
                              product: p,
                              changes: { available },
                            })
                          }
                          aria-label={`Disponibilidade de ${p.name}`}
                        />
                      </>
                    ) : (
                      <Badge variant="secondary">Arquivado</Badge>
                    )}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="row-span-2 md:row-span-1"
                        aria-label={`Ações de ${p.name}`}
                      >
                        <MoreVertical />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(p)}>
                        <Pencil /> Editar
                      </DropdownMenuItem>
                      {p.maxFlavors ? (
                        <DropdownMenuItem asChild>
                          <Link to="/produtos/pizzaria">
                            <PizzaIcon /> Abrir na pizzaria
                          </Link>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem asChild>
                          <Link to={`/produtos/${p.id}/montar`}>
                            <ChefHat /> Abrir no montador
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {p.active ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setArchiving(p)}
                        >
                          <Archive /> Arquivar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() =>
                            update.mutate({
                              product: p,
                              changes: { active: true },
                            })
                          }
                        >
                          <ArchiveRestore /> Restaurar ao cardápio
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <AlertDialog
        open={!!archiving}
        onOpenChange={(o) => !o && !update.isPending && setArchiving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O produto sai do cardápio e não pode mais ser lançado. Pedidos e
              contas antigos continuam mostrando o item com o preço da venda.
              Você pode restaurá-lo depois em “Arquivados”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={update.isPending}>
              Voltar
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={update.isPending}
              onClick={() =>
                archiving &&
                update.mutate({
                  product: archiving,
                  changes: { active: false },
                })
              }
            >
              {update.isPending && <Loader2 className="animate-spin" />}
              Sim, arquivar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CategoryList({ onEdit }: { onEdit: (c: Category) => void }) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const products = useAdminProducts();
  const toggle = useMutation({
    mutationFn: (c: Category) =>
      api.updateCategory(c.id, { active: !c.active }),
    onSuccess: (c) =>
      toast.success(
        c.active
          ? `Categoria ${c.name} restaurada`
          : `Categoria ${c.name} arquivada`,
      ),
    onError: toastError,
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.categories }),
  });

  if (categories.isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (!categories.data?.length) {
    return (
      <EmptyState
        icon={Tags}
        title="Nenhuma categoria"
        description="Crie categorias para organizar o cardápio."
      />
    );
  }

  const countFor = (id: string) =>
    (products.data ?? []).filter((p) => p.categoryId === id && p.active).length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-[60px_minmax(0,1fr)_110px_40px] gap-4 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span>Ordem</span>
        <span>Categoria</span>
        <span className="text-right">Produtos</span>
        <span />
      </div>
      <ul className="divide-y">
        {categories.data.map((c) => (
          <li
            key={c.id}
            className="grid grid-cols-[60px_minmax(0,1fr)_110px_40px] items-center gap-4 px-5 py-3"
          >
            <span className="text-sm text-muted-foreground tabular">
              {c.sortOrder}
            </span>
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 text-left"
              onClick={() => onEdit(c)}
            >
              <span
                className={cn(
                  'truncate font-medium',
                  !c.active && 'text-muted-foreground',
                )}
              >
                {c.name}
              </span>
              {!c.active && <Badge variant="secondary">Arquivada</Badge>}
            </button>
            <span className="text-right text-sm tabular">{countFor(c.id)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Ações de ${c.name}`}
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(c)}>
                  <Pencil /> Editar
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant={c.active ? 'destructive' : 'default'}
                  onSelect={() => toggle.mutate(c)}
                >
                  {c.active ? (
                    <>
                      <Archive /> Arquivar
                    </>
                  ) : (
                    <>
                      <ArchiveRestore /> Restaurar
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </div>
  );
}
