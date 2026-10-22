import {
  flavorsText,
  type Payment,
  type PaymentMethod,
  parseCents,
  paymentMethodLabel,
  type TabDetail,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  type LucideIcon,
  Minus,
  Plus,
  QrCode,
  ReceiptText,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/api';
import { PageBody } from '@/components/layout';
import { centsToInput, MoneyInput } from '@/components/money-input';
import { adjustmentsText } from '@/components/option-picker';
import { EmptyState, TabStatusBadge } from '@/components/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/errors';
import { clock, formatCents, formatQuantity, tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

const methodIcon: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  credit: CreditCard,
  debit: Wallet,
  pix: QrCode,
};
const methods: PaymentMethod[] = ['cash', 'pix', 'credit', 'debit'];

interface ReceiptLine {
  key: string;
  name: string;
  /** Complementos escolhidos, já somados no preço. */
  extras: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
}

/** Itens ativos de pedidos enviados, somados por produto e preço (formato de cupom). */
function receiptLines(tab: TabDetail) {
  const lines = new Map<string, ReceiptLine>();
  let canceled = 0;
  for (const order of tab.orders) {
    if (order.status !== 'submitted') continue;
    for (const item of order.items) {
      if (item.status !== 'active') {
        canceled++;
        continue;
      }
      // Só junta itens iguais de verdade: mesmo produto, preço e complementos.
      const extras = [
        flavorsText(item.flavors),
        item.options.map((o) => o.name).join(', '),
        adjustmentsText(item.adjustments),
      ]
        .filter(Boolean)
        .join(' · ');
      const key = `${item.productName}|${item.unitPriceCents}|${extras}`;
      const line = lines.get(key);
      if (line) {
        line.quantity += item.quantity;
        line.totalCents += item.totalCents;
      } else {
        lines.set(key, {
          key,
          name: item.productName,
          extras,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          totalCents: item.totalCents,
        });
      }
    }
  }
  const draftItems = tab.orders
    .filter((o) => o.status === 'draft')
    .flatMap((o) => o.items.filter((i) => i.status === 'active')).length;
  return { lines: [...lines.values()], canceled, draftItems };
}

export function CloseTabPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tab = useQuery({
    queryKey: ['tab', id],
    queryFn: () => api.tab(id),
    refetchInterval: 5_000,
  });
  const [confirmClose, setConfirmClose] = useState(false);
  const [refund, setRefund] = useState<Payment | null>(null);

  const update = (t: TabDetail) => {
    qc.setQueryData(['tab', id], t);
    void qc.invalidateQueries({ queryKey: ['tabs'] });
    void qc.invalidateQueries({ queryKey: ['tables'] });
  };

  const close = useMutation({
    mutationFn: (t: TabDetail) => api.closeTab(t.id, t.version),
    onSuccess: (t) => {
      update(t);
      setConfirmClose(false);
      toast.success(
        t.tableNumber !== null
          ? `Conta fechada · Mesa ${tableLabel(t.tableNumber)} liberada`
          : `Conta da comanda ${t.code} fechada`,
        { description: formatCents(t.totalCents) },
      );
      navigate('/');
    },
    onError: (e) => {
      toastError(e);
      setConfirmClose(false);
      void qc.invalidateQueries({ queryKey: ['tab', id] });
    },
  });

  if (tab.isLoading) {
    return (
      <PageBody className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </PageBody>
    );
  }
  if (!tab.data) {
    return (
      <PageBody>
        <EmptyState
          icon={ReceiptText}
          title="Comanda não encontrada"
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
  const settling = t.status === 'open' || t.status === 'closing';
  const receipt = receiptLines(t);
  const canClose =
    settling &&
    t.balanceCents === 0 &&
    t.totalCents > 0 &&
    receipt.draftItems === 0;
  const place =
    t.tableNumber !== null ? `Mesa ${tableLabel(t.tableNumber)}` : 'Avulsa';

  return (
    <>
      <div className="border-b bg-background px-4 py-5 md:px-8 md:py-6">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link to={`/comandas/${t.id}`}>
            <ArrowLeft /> Voltar à comanda
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Fechar conta · {place}
          </h1>
          <TabStatusBadge status={t.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Comanda {t.code}
          {t.customerName && ` · ${t.customerName}`} · aberta às{' '}
          {clock(t.openedAt)}
        </p>
      </div>

      <PageBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Receipt tab={t} {...receipt} />

        <div className="space-y-4 lg:sticky lg:top-6">
          {t.status === 'closed' && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Conta fechada</AlertTitle>
              <AlertDescription>
                Encerrada às {t.closedAt && clock(t.closedAt)}.
              </AlertDescription>
            </Alert>
          )}
          {t.status === 'canceled' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Comanda cancelada</AlertTitle>
              <AlertDescription>{t.cancelReason}</AlertDescription>
            </Alert>
          )}

          <Totals tab={t} />

          {receipt.draftItems > 0 && settling && (
            <Alert>
              <AlertTriangle />
              <AlertTitle>Pedido em rascunho</AlertTitle>
              <AlertDescription>
                Há {receipt.draftItems}{' '}
                {receipt.draftItems === 1 ? 'item' : 'itens'} não enviados.
                Envie ou cancele na comanda antes de fechar.
              </AlertDescription>
            </Alert>
          )}
          {t.balanceCents < 0 && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Pago a mais</AlertTitle>
              <AlertDescription>
                Os pagamentos passam do total em {formatCents(-t.balanceCents)}.
                Estorne o pagamento errado e lance o valor certo.
              </AlertDescription>
            </Alert>
          )}

          {settling && t.balanceCents > 0 && (
            <PaymentForm tab={t} onPaid={update} />
          )}

          <Payments
            payments={t.payments}
            canRefund={settling}
            onRefund={setRefund}
          />

          {settling && (
            <Button
              size="lg"
              className="h-12 w-full text-base"
              disabled={!canClose}
              onClick={() => setConfirmClose(true)}
            >
              <CheckCircle2 /> Fechar conta e liberar{' '}
              {t.tableNumber !== null ? 'mesa' : 'comanda'}
            </Button>
          )}
        </div>
      </PageBody>

      <AlertDialog
        open={confirmClose}
        onOpenChange={(o) => !o && !close.isPending && setConfirmClose(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar a conta da {place}?</AlertDialogTitle>
            <AlertDialogDescription>
              Total de {formatCents(t.totalCents)}, totalmente pago. A comanda{' '}
              {t.code} será encerrada
              {t.tableNumber !== null && ' e a mesa volta a ficar livre'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={close.isPending}>
              Voltar
            </AlertDialogCancel>
            <Button disabled={close.isPending} onClick={() => close.mutate(t)}>
              {close.isPending && <Loader2 className="animate-spin" />}
              Sim, fechar conta
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RefundDialog
        tabId={t.id}
        payment={refund}
        onClose={() => setRefund(null)}
        onDone={update}
      />
    </>
  );
}

function Receipt({
  tab,
  lines,
  canceled,
}: {
  tab: TabDetail;
  lines: ReceiptLine[];
  canceled: number;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="size-4 text-muted-foreground" /> Consumo
        </CardTitle>
      </CardHeader>
      {lines.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          Nenhum item enviado nesta comanda.
        </p>
      ) : (
        <ul className="divide-y divide-dashed">
          {lines.map((l) => (
            <li key={l.key} className="flex items-baseline gap-3 px-6 py-2.5">
              <span className="w-10 shrink-0 text-sm font-semibold tabular">
                {formatQuantity(l.quantity)}×
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{l.name}</span>
                {l.extras && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.extras}
                  </span>
                )}
                <span className="block text-xs text-muted-foreground tabular">
                  {formatCents(l.unitPriceCents)} un.
                </span>
              </span>
              <span className="text-sm font-medium tabular">
                {formatCents(l.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1 border-t border-dashed px-6 py-4">
        {canceled > 0 && (
          <p className="text-xs text-muted-foreground">
            {canceled} {canceled === 1 ? 'item cancelado' : 'itens cancelados'}{' '}
            (não cobrados)
          </p>
        )}
        <div className="flex items-center justify-between font-semibold">
          <span>Total</span>
          <span className="tabular">{formatCents(tab.totalCents)}</span>
        </div>
      </div>
    </Card>
  );
}

function Totals({ tab }: { tab: TabDetail }) {
  const settled = tab.balanceCents === 0 && tab.totalCents > 0;
  return (
    <Card className="gap-0 py-0">
      <div className="grid grid-cols-3 divide-x">
        <Stat label="Total" value={tab.totalCents} />
        <Stat label="Pago" value={tab.paidCents} />
        <Stat
          label={tab.balanceCents < 0 ? 'Pago a mais' : 'Falta pagar'}
          value={Math.abs(tab.balanceCents)}
          className={cn(
            settled && 'text-free',
            tab.balanceCents > 0 && 'text-primary',
            tab.balanceCents < 0 && 'text-destructive',
          )}
        />
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="px-4 py-4 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold tracking-tight tabular sm:text-2xl',
          className,
        )}
      >
        {formatCents(value)}
      </div>
    </div>
  );
}

function PaymentForm({
  tab,
  onPaid,
}: {
  tab: TabDetail;
  onPaid: (t: TabDetail) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [people, setPeople] = useState(1);
  const [amountText, setAmountText] = useState(centsToInput(tab.balanceCents));
  const [receivedText, setReceivedText] = useState('');

  // Sugestão: saldo dividido pelo número de pessoas (a última paga o restante).
  const suggested = Math.min(
    tab.balanceCents,
    Math.ceil(tab.balanceCents / people),
  );
  useEffect(() => {
    setAmountText(centsToInput(suggested));
    setReceivedText('');
  }, [suggested]);

  const amount = parseCents(amountText);
  const received = receivedText ? parseCents(receivedText) : null;
  const change =
    method === 'cash' && amount !== null && received !== null
      ? received - amount
      : null;
  const amountError =
    amount === null
      ? 'Valor inválido'
      : amount <= 0
        ? 'Informe um valor'
        : amount > tab.balanceCents
          ? `Máximo ${formatCents(tab.balanceCents)}`
          : null;
  const receivedError =
    method === 'cash' &&
    receivedText &&
    (received === null || (amount !== null && received < amount))
      ? 'Menor que o valor'
      : null;

  const bills = useMemo(() => {
    if (amount === null || amount <= 0) return [];
    return [2000, 5000, 10000, 20000].filter((b) => b > amount).slice(0, 3);
  }, [amount]);

  const pay = useMutation({
    mutationFn: () =>
      api.addPayment(tab.id, {
        method,
        amountCents: amount ?? 0,
        receivedCents:
          method === 'cash' && received !== null ? received : undefined,
      }),
    onSuccess: (t) => {
      const p = t.payments.at(-1);
      toast.success(
        `${paymentMethodLabel[method]} de ${formatCents(amount ?? 0)} registrado`,
        {
          description:
            p && p.changeCents > 0
              ? `Troco: ${formatCents(p.changeCents)}`
              : t.balanceCents === 0
                ? 'Conta quitada — pode fechar.'
                : `Falta ${formatCents(t.balanceCents)}`,
        },
      );
      if (people > 1) setPeople((n) => n - 1);
      onPaid(t);
    },
    onError: toastError,
  });

  const valid = !amountError && !receivedError;

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>Registrar pagamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-4 gap-2">
          {methods.map((m) => {
            const Icon = methodIcon[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition',
                  'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  method === m &&
                    'border-primary bg-primary/10 text-primary hover:bg-primary/15',
                )}
              >
                <Icon className="size-5" />
                {paymentMethodLabel[m]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <span className="flex items-center gap-2 text-sm">
            <Users className="size-4 text-muted-foreground" /> Dividir entre
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Menos pessoas"
              disabled={people <= 1}
              onClick={() => setPeople((n) => n - 1)}
            >
              <Minus />
            </Button>
            <span className="w-20 text-center text-sm font-semibold whitespace-nowrap tabular">
              {people} {people === 1 ? 'pessoa' : 'pessoas'}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Mais pessoas"
              disabled={people >= 20}
              onClick={() => setPeople((n) => n + 1)}
            >
              <Plus />
            </Button>
          </div>
        </div>

        <div
          className={cn('grid gap-4', method === 'cash' && 'sm:grid-cols-2')}
        >
          <div className="grid gap-2">
            <Label htmlFor="amount">Valor{people > 1 && ' (por pessoa)'}</Label>
            <MoneyInput
              id="amount"
              value={amountText}
              onChange={setAmountText}
              invalid={!!amountError}
            />
            <span className="text-xs text-muted-foreground">
              {amountError ?? (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => {
                    setPeople(1);
                    setAmountText(centsToInput(tab.balanceCents));
                  }}
                >
                  Saldo total: {formatCents(tab.balanceCents)}
                </button>
              )}
            </span>
          </div>
          {method === 'cash' && (
            <div className="grid gap-2">
              <Label htmlFor="received">Valor recebido</Label>
              <MoneyInput
                id="received"
                value={receivedText}
                onChange={setReceivedText}
                placeholder={amountText}
                invalid={!!receivedError}
              />
              <div className="flex flex-wrap gap-1.5">
                {bills.map((b) => (
                  <Button
                    key={b}
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setReceivedText(centsToInput(b))}
                  >
                    {formatCents(b)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {change !== null && change >= 0 && (
          <div className="flex items-center justify-between rounded-lg bg-free/10 px-4 py-3 text-free">
            <span className="text-sm font-medium">Troco</span>
            <span className="text-xl font-semibold tabular">
              {formatCents(change)}
            </span>
          </div>
        )}

        <Button
          className="w-full"
          size="lg"
          disabled={!valid || pay.isPending}
          onClick={() => pay.mutate()}
        >
          {pay.isPending && <Loader2 className="animate-spin" />}
          Registrar {paymentMethodLabel[method]}
          {amount !== null && amount > 0 && ` · ${formatCents(amount)}`}
        </Button>
      </CardContent>
    </Card>
  );
}

function Payments({
  payments,
  canRefund,
  onRefund,
}: {
  payments: Payment[];
  canRefund: boolean;
  onRefund: (p: Payment) => void;
}) {
  if (payments.length === 0) return null;
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Pagamentos</CardTitle>
      </CardHeader>
      <ul className="divide-y">
        {payments.map((p) => {
          const Icon = methodIcon[p.method];
          const canceled = p.status === 'canceled';
          return (
            <li key={p.id} className="flex items-center gap-3 px-6 py-3">
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  canceled ? 'text-muted-foreground' : 'text-primary',
                )}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'text-sm font-medium',
                    canceled && 'text-muted-foreground line-through',
                  )}
                >
                  {paymentMethodLabel[p.method]} · {clock(p.createdAt)}
                </div>
                {p.receivedCents !== null && !canceled && (
                  <div className="text-xs text-muted-foreground tabular">
                    Recebido {formatCents(p.receivedCents)} · troco{' '}
                    {formatCents(p.changeCents)}
                  </div>
                )}
                {canceled && (
                  <div className="text-xs text-destructive">
                    Estornado: {p.cancelReason}
                  </div>
                )}
              </div>
              <span
                className={cn(
                  'text-sm font-semibold tabular',
                  canceled && 'text-muted-foreground line-through',
                )}
              >
                {formatCents(p.amountCents)}
              </span>
              {canRefund && !canceled && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Estornar pagamento"
                  onClick={() => onRefund(p)}
                >
                  <Undo2 />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RefundDialog({
  tabId,
  payment,
  onClose,
  onDone,
}: {
  tabId: string;
  payment: Payment | null;
  onClose: () => void;
  onDone: (t: TabDetail) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (payment) setReason('');
  }, [payment]);
  const refund = useMutation({
    mutationFn: (p: Payment) =>
      api.cancelPayment(tabId, p.id, { reason: reason.trim() }),
    onSuccess: (t, p) => {
      toast.success(`Pagamento de ${formatCents(p.amountCents)} estornado`);
      onDone(t);
      onClose();
    },
    onError: toastError,
  });
  return (
    <AlertDialog
      open={!!payment}
      onOpenChange={(o) => !o && !refund.isPending && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Estornar {payment && paymentMethodLabel[payment.method]} de{' '}
            {payment && formatCents(payment.amountCents)}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            O valor volta para o saldo da conta. O estorno fica registrado com o
            motivo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="refund-reason">Motivo</Label>
          <Textarea
            id="refund-reason"
            rows={2}
            maxLength={300}
            placeholder="Ex.: lançado no cartão errado"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={refund.isPending}>
            Voltar
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || refund.isPending}
            onClick={() => payment && refund.mutate(payment)}
          >
            {refund.isPending && <Loader2 className="animate-spin" />}
            Estornar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
