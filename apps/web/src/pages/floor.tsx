import type { DiningTable, TabSummary } from '@muquifo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Armchair,
  Clock,
  DoorOpen,
  Plus,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/api';
import { PageBody, PageHeader } from '@/components/layout';
import { ReleaseTableDialog } from '@/components/release-table-dialog';
import {
  EmptyState,
  OpenTabDialog,
  tableStatusColor,
  tableStatusLabel,
} from '@/components/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { elapsed, formatCents, tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'free' | 'busy';

/** Comandas abertas e em fechamento; atualiza sozinho até existir WebSocket. */
export function useActiveTabs() {
  return useQuery({
    queryKey: ['tabs', 'active'],
    queryFn: async () => {
      const [open, closing] = await Promise.all([
        api.tabs({ status: 'open' }),
        api.tabs({ status: 'closing' }),
      ]);
      return [...open, ...closing];
    },
    refetchInterval: 5_000,
  });
}

export function FloorPage() {
  const navigate = useNavigate();
  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: api.tables,
    refetchInterval: 5_000,
  });
  const tabs = useActiveTabs();
  const [filter, setFilter] = useState<Filter>('all');
  const [openFor, setOpenFor] = useState<DiningTable | null | undefined>();
  const [choose, setChoose] = useState<DiningTable | null>(null);
  const [release, setRelease] = useState<TabSummary | null>(null);

  const tabsByTable = useMemo(() => {
    const map = new Map<string, TabSummary[]>();
    for (const t of tabs.data ?? []) {
      if (t.tableId) map.set(t.tableId, [...(map.get(t.tableId) ?? []), t]);
    }
    return map;
  }, [tabs.data]);

  const active = (tables.data ?? []).filter((t) => t.active);
  const counts = {
    free: active.filter((t) => t.status === 'free').length,
    busy: active.filter((t) => t.status !== 'free').length,
  };
  const visible = active.filter((t) =>
    filter === 'all'
      ? true
      : filter === 'free'
        ? t.status === 'free'
        : t.status !== 'free',
  );
  const walkIns = (tabs.data ?? []).filter((t) => !t.tableId);

  function onTableClick(table: DiningTable) {
    const list = tabsByTable.get(table.id) ?? [];
    if (list.length === 0) setOpenFor(table);
    else if (list.length === 1) navigate(`/comandas/${list[0].id}`);
    else setChoose(table);
  }

  return (
    <>
      <PageHeader
        title="Salão"
        description={
          tables.data
            ? `${counts.free} livres · ${counts.busy} ocupadas · ${walkIns.length} avulsas`
            : 'Carregando mesas…'
        }
        actions={
          <Button onClick={() => setOpenFor(null)}>
            <ShoppingBag /> Comanda avulsa
          </Button>
        }
      >
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">Todas ({active.length})</TabsTrigger>
            <TabsTrigger value="free">Livres ({counts.free})</TabsTrigger>
            <TabsTrigger value="busy">Ocupadas ({counts.busy})</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>

      <PageBody className="space-y-8">
        {tables.isLoading ? (
          <TableGridSkeleton />
        ) : active.length === 0 ? (
          <EmptyState
            icon={Armchair}
            title="Nenhuma mesa cadastrada"
            description="Cadastre as mesas do salão em Cadastros."
            action={
              <Button variant="outline" onClick={() => navigate('/cadastros')}>
                Ir para Cadastros
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {visible.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                tabs={tabsByTable.get(table.id) ?? []}
                onClick={() => onTableClick(table)}
                onRelease={() => {
                  const tab = tabsByTable.get(table.id)?.[0];
                  if (tab) setRelease(tab);
                }}
              />
            ))}
          </div>
        )}

        {walkIns.length > 0 && filter !== 'free' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Comandas avulsas
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {walkIns.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigate(`/comandas/${tab.id}`)}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition hover:border-primary/40 hover:shadow-md"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">Comanda {tab.code}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {tab.customerName ?? 'Sem nome'} · {elapsed(tab.openedAt)}
                    </div>
                  </div>
                  <div className="tabular font-semibold">
                    {formatCents(tab.totalCents)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </PageBody>

      <ReleaseTableDialog tab={release} onClose={() => setRelease(null)} />

      <OpenTabDialog
        table={openFor ?? null}
        open={openFor !== undefined}
        onOpenChange={(o) => !o && setOpenFor(undefined)}
      />

      <Dialog open={!!choose} onOpenChange={(o) => !o && setChoose(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Mesa {choose && tableLabel(choose.number)}
            </DialogTitle>
            <DialogDescription>
              Esta mesa tem mais de uma comanda aberta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {(choose ? (tabsByTable.get(choose.id) ?? []) : []).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(`/comandas/${tab.id}`)}
                className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-accent"
              >
                <span>
                  <span className="font-medium">Comanda {tab.code}</span>
                  <span className="block text-sm text-muted-foreground">
                    {tab.customerName ?? 'Sem nome'} · {elapsed(tab.openedAt)}
                  </span>
                </span>
                <span className="tabular font-semibold">
                  {formatCents(tab.totalCents)}
                </span>
              </button>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const table = choose;
                setChoose(null);
                setOpenFor(table);
              }}
            >
              <Plus /> Nova comanda nesta mesa
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TableCard({
  table,
  tabs,
  onClick,
  onRelease,
}: {
  table: DiningTable;
  tabs: TabSummary[];
  onClick: () => void;
  onRelease: () => void;
}) {
  const free = table.status === 'free';
  const total = tabs.reduce((sum, t) => sum + t.totalCents, 0);
  const items = tabs.reduce((sum, t) => sum + t.itemCount, 0);
  const since = tabs.map((t) => t.openedAt).sort()[0];
  // Mesa aberta e deixada ocupada sem nada enviado: atalho para liberar (com confirmação).
  const releasable = !free && tabs.length === 1 && total === 0 && items === 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group relative flex size-full min-h-36 flex-col overflow-hidden rounded-xl border bg-card p-4 text-left shadow-xs transition',
          'hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          free ? 'hover:border-free/50' : 'border-busy/30 hover:border-busy/60',
          table.status === 'closing' && 'border-closing/40',
        )}
      >
        <span
          className={cn(
            'absolute inset-x-0 top-0 h-1',
            tableStatusColor[table.status],
          )}
        />
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-3xl font-semibold tracking-tight tabular">
              {tableLabel(table.number)}
            </div>
            {table.label && (
              <div className="text-xs text-muted-foreground">{table.label}</div>
            )}
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span
              className={cn(
                'size-2 rounded-full',
                tableStatusColor[table.status],
              )}
            />
            {tableStatusLabel[table.status]}
          </span>
        </div>

        <div className="mt-auto pt-4">
          {free ? (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                {table.seats && (
                  <>
                    <Users className="size-3.5" /> {table.seats}
                  </>
                )}
              </span>
              <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <Plus className="size-3.5" /> Abrir
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-lg font-semibold tabular">
                {formatCents(total)}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">
                  {`${tabs.length > 1 ? `${tabs.length} comandas` : `Comanda ${tabs[0]?.code ?? ''}`} · ${items} ${items === 1 ? 'item' : 'itens'}`}
                </span>
                {since && !releasable && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {elapsed(since).replace('há ', '')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </button>
      {releasable && onRelease && (
        <Button
          size="xs"
          variant="outline"
          className="absolute right-3 bottom-3 bg-card"
          onClick={onRelease}
        >
          <DoorOpen /> Liberar
        </Button>
      )}
    </div>
  );
}

function TableGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}
