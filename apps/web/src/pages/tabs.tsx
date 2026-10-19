import type { TabStatus } from '@muquifo/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ReceiptText, Search, ShoppingBag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '@/api';
import { PageBody, PageHeader } from '@/components/layout';
import { EmptyState, OpenTabDialog, TabStatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { elapsed, formatCents, tableLabel } from '@/lib/format';

type Filter = 'open' | 'closed' | 'all';

const statusFor: Record<Filter, TabStatus | undefined> = {
  open: 'open',
  closed: 'closed',
  all: undefined,
};

export function TabsPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const tabs = useQuery({
    queryKey: queryKeys.tabs(statusFor[filter]),
    queryFn: () => api.tabs({ status: statusFor[filter] }),
    refetchInterval: 5_000,
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tabs.data ?? [];
    return (tabs.data ?? []).filter(
      (t) =>
        String(t.code).includes(term) ||
        (t.tableNumber !== null && String(t.tableNumber) === term) ||
        t.customerName?.toLowerCase().includes(term),
    );
  }, [tabs.data, search]);

  const openTotal =
    filter === 'open'
      ? (tabs.data ?? []).reduce((s, t) => s + t.totalCents, 0)
      : null;

  return (
    <>
      <PageHeader
        title="Comandas"
        description={
          openTotal !== null && tabs.data
            ? `${tabs.data.length} abertas · ${formatCents(openTotal)} em consumo`
            : 'Histórico de comandas'
        }
        actions={
          <Button onClick={() => setWalkIn(true)}>
            <ShoppingBag /> Comanda avulsa
          </Button>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="open">Abertas</TabsTrigger>
              <TabsTrigger value="closed">Fechadas</TabsTrigger>
              <TabsTrigger value="all">Todas</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative sm:w-72">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Código, mesa ou cliente"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </PageHeader>

      <PageBody>
        {tabs.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={search ? 'Nada encontrado' : 'Nenhuma comanda aqui'}
            description={
              search
                ? 'Tente outro código, número de mesa ou nome.'
                : filter === 'open'
                  ? 'Abra uma comanda pelo Salão ou como avulsa.'
                  : undefined
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="hidden grid-cols-[100px_1fr_120px_110px_120px_24px] gap-4 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid">
              <span>Comanda</span>
              <span>Mesa / cliente</span>
              <span>Situação</span>
              <span className="text-right">Itens</span>
              <span className="text-right">Total</span>
              <span />
            </div>
            <ul className="divide-y">
              {visible.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/comandas/${t.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition hover:bg-accent/50 md:grid-cols-[100px_1fr_120px_110px_120px_24px]"
                  >
                    <span className="font-semibold tabular">{t.code}</span>
                    <span className="order-3 col-span-2 min-w-0 truncate text-sm text-muted-foreground md:order-none md:col-span-1">
                      <span className="font-medium text-foreground">
                        {t.tableNumber !== null
                          ? `Mesa ${tableLabel(t.tableNumber)}`
                          : 'Avulsa'}
                      </span>
                      {t.customerName && ` · ${t.customerName}`} ·{' '}
                      {elapsed(t.openedAt)}
                    </span>
                    <span className="hidden md:block">
                      <TabStatusBadge status={t.status} />
                    </span>
                    <span className="hidden text-right text-sm text-muted-foreground tabular md:block">
                      {t.itemCount}
                    </span>
                    <span className="text-right font-semibold tabular">
                      {formatCents(t.totalCents)}
                    </span>
                    <ChevronRight className="hidden size-4 text-muted-foreground md:block" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PageBody>

      <OpenTabDialog table={null} open={walkIn} onOpenChange={setWalkIn} />
    </>
  );
}
