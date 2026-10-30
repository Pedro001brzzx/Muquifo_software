import {
  flavorsText,
  type Order,
  type OrderItem,
  type TabDetail,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  DoorOpen,
  Loader2,
  MoreVertical,
  Plus,
  ReceiptText,
  Send,
  Trash2,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, api } from '@/api';
import { CancelDialog, type CancelTarget } from '@/components/cancel-dialog';
import { PageBody } from '@/components/layout';
import { type CartLine, NewOrderSheet } from '@/components/new-order-sheet';
import { adjustmentsText } from '@/components/option-picker';
import { ReleaseTableDialog } from '@/components/release-table-dialog';
import {
  EmptyState,
  OrderStatusBadge,
  TabStatusBadge,
} from '@/components/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { toastError } from '@/lib/errors';
import {
  clock,
  elapsed,
  formatCents,
  formatQuantity,
  tableLabel,
} from '@/lib/format';
import { cn } from '@/lib/utils';

export function TabDetailPage() {
  const { id = '' } = useParams();
  const canSettle = useCan('cashier');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tab = useQuery({
    queryKey: ['tab', id],
    queryFn: () => api.tab(id),
    refetchInterval: 5_000,
  });
  const [orderOpen, setOrderOpen] = useState(false);
  const [release, setRelease] = useState(false);
  // O carrinho sobrevive a fechar o painel, para o garçom não perder o que montou.
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const refresh = (order?: Order) => {
    if (order && tab.data) {
      qc.setQueryData<TabDetail>(
        ['tab', id],
        (t) =>
          t && {
            ...t,
            orders: t.orders.map((o) => (o.id === order.id ? order : o)),
          },
      );
    }
    void qc.invalidateQueries({ queryKey: ['tab', id] });
    void qc.invalidateQueries({ queryKey: ['tabs'] });
    void qc.invalidateQueries({ queryKey: ['tables'] });
  };

  const submit = useMutation({
    mutationFn: (order: Order) => api.submitOrder(order.id, order.version),
    onSuccess: (order) => {
      toast.success(`Pedido #${order.number} enviado para produção`);
      refresh(order);
    },
    onError: (e) => {
      toastError(e);
      refresh();
    },
  });
  const removeItem = useMutation({
    mutationFn: ({ order, item }: { order: Order; item: OrderItem }) =>
      api.removeItem(order.id, item.id),
    onSuccess: refresh,
    onError: (e) => {
      toastError(e);
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: ({
      target,
      reason,
    }: {
      target: CancelTarget;
      reason: string;
    }) =>
      api.cancelOrder(target.order.id, {
        reason,
        itemIds: target.item ? [target.item.id] : undefined,
      }),
    onSuccess: (order) => {
      toast.success(
        order.status === 'canceled'
          ? `Pedido #${order.number} cancelado`
          : 'Item cancelado',
      );
      setCancelTarget(null);
      refresh(order);
    },
    onError: (e) => {
      toastError(e);
      refresh();
    },
  });

  if (tab.isLoading) return <TabDetailSkeleton />;
  if (!tab.data) {
    const notFound =
      tab.error instanceof ApiRequestError && tab.error.status === 404;
    return (
      <PageBody>
        <EmptyState
          icon={ReceiptText}
          title={
            notFound ? 'Comanda não encontrada' : 'Não foi possível carregar'
          }
          description={
            tab.error instanceof Error ? tab.error.message : undefined
          }
          action={
            <Button variant="outline" asChild>
              <Link to="/comandas">Ver comandas</Link>
            </Button>
          }
        />
      </PageBody>
    );
  }

  const t = tab.data;
  const editable = t.status === 'open';
  const orders = [...t.orders].reverse();
  const busy = submit.isPending || removeItem.isPending;

  return (
    <>
      <div className="border-b bg-background px-4 py-5 md:px-8 md:py-6">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link to="/comandas">
            <ArrowLeft /> Comandas
          </Link>
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                Comanda {t.code}
              </h1>
              <TabStatusBadge status={t.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {t.tableNumber !== null
                  ? `Mesa ${tableLabel(t.tableNumber)}`
                  : 'Avulsa'}
              </span>
              {t.customerName && (
                <span className="flex items-center gap-1">
                  <User className="size-3.5" /> {t.customerName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" /> Aberta às {clock(t.openedAt)}
                {t.status === 'open' && ` · ${elapsed(t.openedAt)}`}
              </span>
            </div>
          </div>
          <div className="hidden text-right md:block">
            <div className="text-sm text-muted-foreground">Total da conta</div>
            <div className="text-3xl font-semibold tracking-tight tabular">
              {formatCents(t.totalCents)}
            </div>
          </div>
        </div>
      </div>

      <PageBody className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <section className="space-y-4">
          {t.status === 'closed' && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Conta fechada</AlertTitle>
              <AlertDescription>
                Encerrada às {t.closedAt && clock(t.closedAt)} ·{' '}
                {formatCents(t.paidCents)} recebidos.{' '}
                {canSettle && (
                  <Link
                    to={`/comandas/${t.id}/fechar`}
                    className="underline underline-offset-2"
                  >
                    Ver pagamentos
                  </Link>
                )}
              </AlertDescription>
            </Alert>
          )}
          {t.status === 'canceled' && (
            <Alert variant="destructive">
              <Ban />
              <AlertTitle>
                Comanda cancelada
                {t.canceledAt && ` às ${clock(t.canceledAt)}`}
              </AlertTitle>
              <AlertDescription>{t.cancelReason}</AlertDescription>
            </Alert>
          )}
          {orders.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="Nenhum pedido ainda"
              description="Lance o primeiro pedido desta comanda."
              action={
                editable && (
                  <Button onClick={() => setOrderOpen(true)}>
                    <Plus /> Novo pedido
                  </Button>
                )
              }
            />
          ) : (
            orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                editable={editable}
                cancelable={t.status === 'open' || t.status === 'closing'}
                busy={busy}
                submitting={
                  submit.isPending && submit.variables?.id === order.id
                }
                onSubmit={() => submit.mutate(order)}
                onRemove={(item) => removeItem.mutate({ order, item })}
                onCancel={(item) => setCancelTarget({ order, item })}
              />
            ))
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <Row label="Consumo enviado" value={t.totalCents} />
              {t.draftCents > 0 && (
                <Row
                  label="Em rascunho (não somado)"
                  value={t.draftCents}
                  muted
                />
              )}
              <Row label="Pago" value={t.paidCents} />
              <Separator />
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Saldo</span>
                <span className="tabular">{formatCents(t.balanceCents)}</span>
              </div>
            </CardContent>
          </Card>
          <div className="hidden gap-2 lg:grid">
            <Button
              size="lg"
              disabled={!editable}
              onClick={() => setOrderOpen(true)}
            >
              <Plus /> Novo pedido
              {cart.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {cart.length} no carrinho
                </Badge>
              )}
            </Button>
            <SettleActions
              tab={t}
              size="lg"
              onRelease={() => setRelease(true)}
            />
          </div>
        </aside>
      </PageBody>

      {/* Barra fixa no celular/tablet: total sempre visível e ação principal ao alcance do polegar. */}
      <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:pl-[calc(15rem+1rem)] lg:hidden">
        <div>
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-lg font-semibold tabular">
            {formatCents(t.totalCents)}
          </div>
        </div>
        <div className="flex gap-2">
          <SettleActions
            tab={t}
            size="lg"
            compact
            onRelease={() => setRelease(true)}
          />
          <Button
            size="lg"
            disabled={!editable}
            onClick={() => setOrderOpen(true)}
          >
            <Plus /> Pedido
            {cart.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {cart.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>
      <div className="h-20 lg:hidden" />

      <ReleaseTableDialog
        tab={release ? t : null}
        onClose={() => setRelease(false)}
        onReleased={() => navigate('/')}
      />

      <NewOrderSheet
        tab={t}
        open={orderOpen}
        onOpenChange={setOrderOpen}
        cart={cart}
        setCart={setCart}
      />
      <CancelDialog
        target={cancelTarget}
        pending={cancel.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) =>
          cancelTarget && cancel.mutate({ target: cancelTarget, reason })
        }
      />
    </>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        muted && 'text-muted-foreground',
      )}
    >
      <span>{label}</span>
      <span className="tabular">{formatCents(value)}</span>
    </div>
  );
}

/**
 * Com consumo: vai para a tela de fechamento. Sem consumo nem pagamento
 * (mesa aberta por engano): libera a mesa, com confirmação.
 */
function SettleActions({
  tab,
  size,
  compact,
  onRelease,
}: {
  tab: TabDetail;
  size: 'lg';
  compact?: boolean;
  onRelease: () => void;
}) {
  const canSettle = useCan('cashier');
  if (tab.status !== 'open' && tab.status !== 'closing') return null;
  if (tab.totalCents === 0 && tab.paidCents === 0) {
    return (
      <Button variant="outline" size={size} onClick={onRelease}>
        <DoorOpen /> {compact ? 'Liberar' : 'Liberar mesa'}
      </Button>
    );
  }
  // Garçom não recebe: a conta é fechada no caixa.
  if (!canSettle) return null;
  return (
    <Button variant="outline" size={size} asChild>
      <Link to={`/comandas/${tab.id}/fechar`}>
        <CreditCard /> {compact ? 'Conta' : 'Fechar conta'}
      </Link>
    </Button>
  );
}

function OrderCard({
  order,
  editable,
  cancelable,
  busy,
  submitting,
  onSubmit,
  onRemove,
  onCancel,
}: {
  order: Order;
  editable: boolean;
  cancelable: boolean;
  busy: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onRemove: (item: OrderItem) => void;
  onCancel: (item?: OrderItem) => void;
}) {
  const draft = order.status === 'draft';
  const canceled = order.status === 'canceled';
  const activeItems = order.items.filter((i) => i.status === 'active');

  return (
    <Card
      className={cn(
        'gap-0 py-0',
        draft && 'border-dashed',
        canceled && 'opacity-70',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Pedido #{order.number}</span>
          <OrderStatusBadge status={order.status} />
          <span className="text-xs text-muted-foreground">
            {order.submittedAt
              ? `enviado às ${clock(order.submittedAt)}`
              : `criado às ${clock(order.createdAt)}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {draft && editable && (
            <Button
              size="sm"
              disabled={busy || activeItems.length === 0}
              onClick={onSubmit}
            >
              {submitting ? <Loader2 className="animate-spin" /> : <Send />}
              Enviar
            </Button>
          )}
          {!canceled && cancelable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Ações do pedido"
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onCancel()}
                >
                  <Ban /> Cancelar pedido
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Separator />
      <ul className="divide-y">
        {order.items.length === 0 && (
          <li className="px-5 py-4 text-sm text-muted-foreground">
            Pedido sem itens.
          </li>
        )}
        {order.items.map((item) => {
          const itemCanceled = item.status === 'canceled';
          return (
            <li key={item.id} className="flex items-start gap-3 px-5 py-3">
              <span
                className={cn(
                  'mt-0.5 min-w-8 rounded-md bg-muted px-1.5 py-0.5 text-center text-xs font-semibold tabular',
                  itemCanceled && 'line-through',
                )}
              >
                {formatQuantity(item.quantity)}×
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'text-sm font-medium',
                    itemCanceled && 'text-muted-foreground line-through',
                  )}
                >
                  {item.productName}
                </div>
                {item.flavors.length > 0 && (
                  <div
                    className={cn(
                      'text-xs font-medium',
                      itemCanceled && 'line-through',
                    )}
                  >
                    {flavorsText(item.flavors)}
                  </div>
                )}
                {item.options.length > 0 && (
                  <div
                    className={cn(
                      'text-xs text-muted-foreground',
                      itemCanceled && 'line-through',
                    )}
                  >
                    {item.options
                      .map(
                        (o) =>
                          o.name +
                          (o.priceCents
                            ? ` (+${formatCents(o.priceCents)})`
                            : ''),
                      )
                      .join(' · ')}
                  </div>
                )}
                {item.adjustments.length > 0 && (
                  <div
                    className={cn(
                      'text-xs font-medium text-destructive/80',
                      itemCanceled && 'line-through',
                    )}
                  >
                    {adjustmentsText(item.adjustments)}
                  </div>
                )}
                {item.notes && (
                  <div className="text-xs text-muted-foreground italic">
                    “{item.notes}”
                  </div>
                )}
                {itemCanceled && (
                  <div className="text-xs text-destructive">
                    Cancelado
                    {item.canceledAt && ` às ${clock(item.canceledAt)}`}:{' '}
                    {item.cancelReason}
                  </div>
                )}
                {!itemCanceled && item.quantity !== 1 && (
                  <div className="text-xs text-muted-foreground tabular">
                    {formatCents(item.unitPriceCents)} cada
                  </div>
                )}
              </div>
              <span
                className={cn(
                  'text-sm font-medium tabular',
                  itemCanceled && 'text-muted-foreground line-through',
                )}
              >
                {formatCents(item.totalCents)}
              </span>
              {!itemCanceled && draft && editable && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remover ${item.productName}`}
                  disabled={busy}
                  onClick={() => onRemove(item)}
                >
                  <Trash2 />
                </Button>
              )}
              {!itemCanceled && !draft && cancelable && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Cancelar ${item.productName}`}
                  onClick={() => onCancel(item)}
                >
                  <Ban />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {order.items.length > 0 && (
        <>
          <Separator />
          <div className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="text-muted-foreground">
              {canceled && order.cancelReason
                ? `Motivo: ${order.cancelReason}`
                : `${activeItems.length} ${activeItems.length === 1 ? 'item' : 'itens'}`}
            </span>
            <span className="font-semibold tabular">
              {formatCents(order.totalCents)}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function TabDetailSkeleton() {
  return (
    <PageBody className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-5 w-72" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </PageBody>
  );
}
