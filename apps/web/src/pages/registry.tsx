import { type Product, parseCents } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Armchair,
  FolderPlus,
  Loader2,
  Plus,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { PageBody, PageHeader } from '@/components/layout';
import {
  EmptyState,
  tableStatusColor,
  tableStatusLabel,
} from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCents, tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

type DialogKind = 'category' | 'product' | 'table' | null;

export function RegistryPage() {
  const [section, setSection] = useState('menu');
  const [dialog, setDialog] = useState<DialogKind>(null);

  return (
    <Tabs value={section} onValueChange={setSection}>
      <PageHeader
        title="Cadastros"
        description="Cardápio e mesas do salão."
        actions={
          section === 'menu' ? (
            <>
              <Button variant="outline" onClick={() => setDialog('category')}>
                <FolderPlus /> Categoria
              </Button>
              <Button onClick={() => setDialog('product')}>
                <Plus /> Produto
              </Button>
            </>
          ) : (
            <Button onClick={() => setDialog('table')}>
              <Plus /> Mesa
            </Button>
          )
        }
      >
        <TabsList>
          <TabsTrigger value="menu">
            <UtensilsCrossed /> Cardápio
          </TabsTrigger>
          <TabsTrigger value="tables">
            <Armchair /> Mesas
          </TabsTrigger>
        </TabsList>
      </PageHeader>
      <PageBody>
        <TabsContent value="menu">
          <MenuSection />
        </TabsContent>
        <TabsContent value="tables">
          <TablesSection />
        </TabsContent>
      </PageBody>

      <CategoryDialog
        open={dialog === 'category'}
        onClose={() => setDialog(null)}
      />
      <ProductDialog
        open={dialog === 'product'}
        onClose={() => setDialog(null)}
      />
      <TableDialog open={dialog === 'table'} onClose={() => setDialog(null)} />
    </Tabs>
  );
}

function MenuSection() {
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
    queryKey: queryKeys.products,
    queryFn: api.products,
  });

  const toggle = useMutation({
    mutationFn: (p: Product) =>
      api.setAvailability(p.id, {
        available: !p.available,
        version: p.version,
      }),
    onSuccess: (p) =>
      toast.success(
        `${p.name} ${p.available ? 'disponível' : 'marcado como esgotado'}`,
      ),
    onError: toastError,
    // Em conflito de versão também recarrega, para mostrar o estado atual.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.products }),
  });

  if (categories.isLoading || products.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (!categories.data?.length) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="Cardápio vazio"
        description="Crie uma categoria e depois os produtos."
      />
    );
  }

  const sectorName = new Map(sectors.data?.map((s) => [s.id, s.name]));
  return (
    <div className="space-y-6">
      {categories.data.map((c) => {
        const items = (products.data ?? []).filter(
          (p) => p.categoryId === c.id,
        );
        return (
          <section
            key={c.id}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <div className="flex items-center justify-between border-b bg-muted/40 px-5 py-3">
              <h2 className="font-semibold">{c.name}</h2>
              <span className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? 'produto' : 'produtos'}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                Sem produtos.
              </p>
            ) : (
              <ul className="divide-y">
                {items.map((p) => (
                  <li key={p.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'truncate font-medium',
                          !p.available && 'text-muted-foreground line-through',
                        )}
                      >
                        {p.name}
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Badge variant="secondary">
                          {p.sectorId
                            ? sectorName.get(p.sectorId)
                            : 'Sem setor'}
                        </Badge>
                        {p.allowFractional && (
                          <Badge variant="outline">Por peso</Badge>
                        )}
                      </div>
                    </div>
                    <span className="tabular font-semibold">
                      {formatCents(p.priceCents)}
                    </span>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="hidden w-16 text-right sm:inline">
                        {p.available ? 'Disponível' : 'Esgotado'}
                      </span>
                      <Switch
                        checked={p.available}
                        disabled={
                          toggle.isPending && toggle.variables?.id === p.id
                        }
                        onCheckedChange={() => toggle.mutate(p)}
                        aria-label={`Disponibilidade de ${p.name}`}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TablesSection() {
  const tables = useQuery({ queryKey: queryKeys.tables, queryFn: api.tables });
  if (tables.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!tables.data?.length) {
    return <EmptyState icon={Armchair} title="Nenhuma mesa cadastrada" />;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tables.data.map((t) => (
        <div key={t.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between">
            <span className="text-2xl font-semibold tabular">
              {tableLabel(t.number)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'size-2 rounded-full',
                  tableStatusColor[t.status],
                )}
              />
              {tableStatusLabel[t.status]}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span className="truncate">{t.label ?? '—'}</span>
            {t.seats && (
              <span className="flex items-center gap-1">
                <Users className="size-3.5" /> {t.seats}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormDialog({
  open,
  onClose,
  title,
  pending,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  pending: boolean;
  onSubmit: (data: FormData, form: HTMLFormElement) => void;
  children: ReactNode;
}) {
  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget), e.currentTarget);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handle} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">{children}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function CategoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: api.createCategory,
    onSuccess: (c) => {
      toast.success(`Categoria ${c.name} criada`);
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      onClose();
    },
    onError: toastError,
  });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Nova categoria"
      pending={create.isPending}
      onSubmit={(d) =>
        create.mutate({
          name: String(d.get('name')),
          sortOrder: Number(d.get('sortOrder') || 0),
        })
      }
    >
      <Field label="Nome">
        <Input
          name="name"
          required
          maxLength={120}
          autoFocus
          placeholder="Ex.: Sobremesas"
        />
      </Field>
      <Field label="Ordem de exibição">
        <Input name="sortOrder" type="number" min={0} defaultValue={0} />
      </Field>
    </FormDialog>
  );
}

function ProductDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categories,
    queryFn: api.categories,
  });
  const sectors = useQuery({
    queryKey: queryKeys.sectors,
    queryFn: api.sectors,
  });
  const [categoryId, setCategoryId] = useState('');
  const [sectorId, setSectorId] = useState('none');
  const [fractional, setFractional] = useState(false);
  const create = useMutation({
    mutationFn: api.createProduct,
    onSuccess: (p) => {
      toast.success(`${p.name} adicionado ao cardápio`);
      void qc.invalidateQueries({ queryKey: queryKeys.products });
      setFractional(false);
      onClose();
    },
    onError: toastError,
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Novo produto"
      pending={create.isPending}
      onSubmit={(d) => {
        const priceCents = parseCents(String(d.get('price')));
        if (priceCents === null) {
          toast.error('Preço inválido', {
            description: 'Use o formato 12,50.',
          });
          return;
        }
        if (!categoryId) {
          toast.error('Escolha a categoria');
          return;
        }
        create.mutate({
          categoryId,
          sectorId: sectorId === 'none' ? null : sectorId,
          name: String(d.get('name')),
          priceCents,
          allowFractional: fractional,
        });
      }}
    >
      <Field label="Nome">
        <Input
          name="name"
          required
          maxLength={120}
          autoFocus
          placeholder="Ex.: Pudim"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Preço (R$)">
          <Input name="price" required inputMode="decimal" placeholder="0,00" />
        </Field>
        <Field label="Categoria">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {categories.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Setor de produção">
        <Select value={sectorId} onValueChange={setSectorId}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum (não vai para produção)</SelectItem>
            {sectors.data?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <span>
          <span className="block text-sm font-medium">Vendido por peso</span>
          <span className="block text-xs text-muted-foreground">
            Permite quantidade fracionada (ex.: 0,350 kg).
          </span>
        </span>
        <Switch checked={fractional} onCheckedChange={setFractional} />
      </label>
    </FormDialog>
  );
}

function TableDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: api.createTable,
    onSuccess: (t) => {
      toast.success(`Mesa ${tableLabel(t.number)} cadastrada`);
      void qc.invalidateQueries({ queryKey: queryKeys.tables });
      onClose();
    },
    onError: toastError,
  });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Nova mesa"
      pending={create.isPending}
      onSubmit={(d) =>
        create.mutate({
          number: Number(d.get('number')),
          label: String(d.get('label')).trim() || null,
          seats: d.get('seats') ? Number(d.get('seats')) : null,
        })
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Número">
          <Input
            name="number"
            type="number"
            min={1}
            max={9999}
            required
            autoFocus
          />
        </Field>
        <Field label="Lugares">
          <Input name="seats" type="number" min={1} max={100} />
        </Field>
      </div>
      <Field label="Rótulo (opcional)">
        <Input name="label" maxLength={60} placeholder="Ex.: Varanda" />
      </Field>
    </FormDialog>
  );
}
