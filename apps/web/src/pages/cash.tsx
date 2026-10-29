import {
  type CashMovementKind,
  type CashSession,
  cashMovementKindLabel,
  type MethodTotals,
  type PaymentMethod,
  parseCents,
  paymentMethodLabel,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Loader2,
  Lock,
  LockOpen,
  Wallet,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { Field } from '@/components/form-dialog';
import { PageBody, PageHeader } from '@/components/layout';
import { MoneyInput } from '@/components/money-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/errors';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

const methods: PaymentMethod[] = ['cash', 'credit', 'debit', 'pix'];
const OPERATOR_KEY = 'muquifo.cash-operator';

function lastOperator() {
  try {
    return localStorage.getItem(OPERATOR_KEY) ?? '';
  } catch {
    return '';
  }
}
function rememberOperator(name: string) {
  try {
    localStorage.setItem(OPERATOR_KEY, name);
  } catch {
    // Sem armazenamento: só não lembra o nome.
  }
}

const time = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const sum = (t: MethodTotals) => t.cash + t.credit + t.debit + t.pix;

/** Diferença com sinal e tom: faltou (vermelho), sobrou (âmbar), bateu (verde). */
function Difference({ cents, big }: { cents: number; big?: boolean }) {
  return (
    <span
      className={cn(
        'font-semibold tabular',
        big && 'text-2xl',
        cents < 0 ? 'text-destructive' : cents > 0 ? 'text-busy' : 'text-free',
      )}
    >
      {cents === 0
        ? 'Bateu'
        : `${cents < 0 ? 'Faltou' : 'Sobrou'} ${formatCents(Math.abs(cents))}`}
    </span>
  );
}

/**
 * Caixa do turno: abertura com fundo de troco, sangria/suprimento e
 * fechamento cego (o operador conta sem ver o esperado).
 */
export function CashPage() {
  const current = useQuery({
    queryKey: queryKeys.cash,
    queryFn: api.cashCurrent,
    refetchInterval: 15_000,
  });
  const [result, setResult] = useState<CashSession | null>(null);
  const session = current.data?.session ?? null;

  return (
    <>
      <PageHeader
        title="Caixa"
        description={
          session
            ? `Caixa ${session.number} aberto por ${session.openedBy} às ${time(session.openedAt)}`
            : 'Abra o caixa no começo do turno para receber pagamentos.'
        }
      />
      <PageBody className="space-y-6">
        {current.isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : result ? (
          <CloseResult session={result} onDone={() => setResult(null)} />
        ) : session ? (
          <OpenSession session={session} onClosed={setResult} />
        ) : (
          <OpenForm />
        )}
        <History />
      </PageBody>
    </>
  );
}

function OpenForm() {
  const qc = useQueryClient();
  const [operator, setOperator] = useState(lastOperator);
  const [floatText, setFloatText] = useState('');
  const [error, setError] = useState('');
  const open = useMutation({
    mutationFn: () =>
      api.openCash({
        operator: operator.trim(),
        openingFloatCents: parseCents(floatText) ?? 0,
      }),
    onSuccess: (s) => {
      rememberOperator(s.openedBy);
      toast.success(`Caixa ${s.number} aberto`);
    },
    onError: toastError,
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.cash }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!operator.trim()) return setError('Quem está abrindo o caixa?');
    if (floatText && parseCents(floatText) === null)
      return setError('Valor do troco inválido.');
    open.mutate();
  }

  return (
    <Card className="mx-auto max-w-md gap-5">
      <CardHeader className="items-center text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted">
          <Lock className="size-7 text-muted-foreground" />
        </span>
        <CardTitle className="text-xl">Caixa fechado</CardTitle>
        <p className="text-sm text-muted-foreground">
          Conte o dinheiro que está na gaveta (o troco) e abra o caixa.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Quem está abrindo?" htmlFor="cash-operator">
            <Input
              id="cash-operator"
              className="h-12 text-lg md:text-lg"
              maxLength={60}
              value={operator}
              onChange={(e) => {
                setOperator(e.target.value);
                setError('');
              }}
            />
          </Field>
          <Field label="Troco na gaveta" htmlFor="cash-float">
            <MoneyInput
              id="cash-float"
              className="h-14 text-2xl md:text-2xl"
              value={floatText}
              onChange={(v) => {
                setFloatText(v);
                setError('');
              }}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="h-14 w-full text-lg"
            disabled={open.isPending}
          >
            {open.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <LockOpen />
            )}
            Abrir caixa
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Caixa aberto: sem totais na tela (o fechamento é cego). */
function OpenSession({
  session,
  onClosed,
}: {
  session: CashSession;
  onClosed: (s: CashSession) => void;
}) {
  const [movement, setMovement] = useState<CashMovementKind | null>(null);
  const [closing, setClosing] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5 text-primary" /> Caixa {session.number}{' '}
            <Badge className="bg-free text-white">Aberto</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-muted-foreground">Aberto por</dt>
              <dd className="font-semibold">{session.openedBy}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-muted-foreground">Troco inicial</dt>
              <dd className="font-semibold tabular">
                {formatCents(session.openingFloatCents)}
              </dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-muted-foreground">Pagamentos recebidos</dt>
              <dd className="font-semibold tabular">{session.paymentCount}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-muted-foreground">Sangrias / suprimentos</dt>
              <dd className="font-semibold tabular">
                {session.movements.length}
              </dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              className="h-12"
              onClick={() => setMovement('withdrawal')}
            >
              <ArrowUpFromLine /> Sangria
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-12"
              onClick={() => setMovement('reinforcement')}
            >
              <ArrowDownToLine /> Suprimento
            </Button>
          </div>
          <Button
            size="lg"
            className="h-14 w-full text-lg"
            onClick={() => setClosing(true)}
          >
            <Lock /> Fechar caixa
          </Button>
          <p className="text-xs text-muted-foreground">
            Os totais ficam escondidos até o fechamento: quem fecha conta o
            dinheiro sem saber quanto deveria ter.
          </p>
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Movimentos do turno</CardTitle>
        </CardHeader>
        <CardContent>
          {session.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma sangria ou suprimento.
            </p>
          ) : (
            <ul className="divide-y">
              {session.movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  {m.kind === 'withdrawal' ? (
                    <ArrowUpFromLine className="size-4 text-destructive" />
                  ) : (
                    <ArrowDownToLine className="size-4 text-free" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {cashMovementKindLabel[m.kind]} · {m.reason}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {time(m.createdAt)}
                      {m.operator && ` · ${m.operator}`}
                    </span>
                  </span>
                  <span className="font-semibold tabular">
                    {m.kind === 'withdrawal' ? '−' : '+'}
                    {formatCents(m.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <MovementDialog
        session={session}
        kind={movement}
        onClose={() => setMovement(null)}
      />
      <CloseDialog
        session={session}
        open={closing}
        onClose={() => setClosing(false)}
        onClosed={(s) => {
          setClosing(false);
          onClosed(s);
        }}
      />
    </div>
  );
}

function MovementDialog({
  session,
  kind,
  onClose,
}: {
  session: CashSession;
  kind: CashMovementKind | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [operator, setOperator] = useState(lastOperator);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.addCashMovement(session.id, {
        kind: kind!,
        amountCents: parseCents(amountText) ?? 0,
        reason: reason.trim(),
        operator: operator.trim() || null,
      }),
    onSuccess: () => {
      toast.success(`${cashMovementKindLabel[kind!]} registrada`);
      setAmountText('');
      setReason('');
      onClose();
    },
    onError: toastError,
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.cash }),
  });

  if (!kind) return null;
  const withdrawal = kind === 'withdrawal';

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(amountText);
    if (!cents) return setError('Informe o valor.');
    if (reason.trim().length < 3) return setError('Diga o motivo.');
    save.mutate();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{withdrawal ? 'Sangria' : 'Suprimento'}</DialogTitle>
            <DialogDescription>
              {withdrawal
                ? 'Dinheiro retirado da gaveta (depósito, pagamento de fornecedor...).'
                : 'Dinheiro colocado na gaveta (mais troco).'}
            </DialogDescription>
          </DialogHeader>
          <MoneyInput
            id="movement-amount"
            autoFocus
            className="h-14 text-2xl md:text-2xl"
            value={amountText}
            onChange={(v) => {
              setAmountText(v);
              setError('');
            }}
          />
          <Field label="Motivo" htmlFor="movement-reason">
            <Input
              id="movement-reason"
              maxLength={300}
              placeholder={
                withdrawal ? 'Ex.: depósito no banco' : 'Ex.: mais troco'
              }
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
            />
          </Field>
          <Field label="Quem está fazendo" htmlFor="movement-operator">
            <Input
              id="movement-operator"
              maxLength={60}
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fechamento cego: pede o contado de cada forma sem mostrar o esperado. */
function CloseDialog({
  session,
  open,
  onClose,
  onClosed,
}: {
  session: CashSession;
  open: boolean;
  onClose: () => void;
  onClosed: (s: CashSession) => void;
}) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState<Record<PaymentMethod, string>>({
    cash: '',
    credit: '',
    debit: '',
    pix: '',
  });
  const [operator, setOperator] = useState(lastOperator);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const close = useMutation({
    mutationFn: () =>
      api.closeCash(session.id, {
        version: session.version,
        operator: operator.trim(),
        counted: {
          cash: parseCents(counted.cash) ?? 0,
          credit: parseCents(counted.credit) ?? 0,
          debit: parseCents(counted.debit) ?? 0,
          pix: parseCents(counted.pix) ?? 0,
        },
        notes: notes.trim() || null,
      }),
    onSuccess: (s) => {
      rememberOperator(s.closedBy ?? '');
      onClosed(s);
    },
    onError: (e) => {
      toastError(e);
      void qc.invalidateQueries({ queryKey: queryKeys.cash });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.cash });
      void qc.invalidateQueries({ queryKey: ['cash-history'] });
    },
  });

  const hints: Record<PaymentMethod, string> = {
    cash: 'Conte todo o dinheiro da gaveta, inclusive o troco.',
    credit: 'Total de crédito no relatório da maquininha.',
    debit: 'Total de débito no relatório da maquininha.',
    pix: 'Total de PIX recebido no extrato.',
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!operator.trim()) return setError('Quem está fechando o caixa?');
    if (methods.some((m) => counted[m] && parseCents(counted[m]) === null))
      return setError('Algum valor está inválido.');
    close.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !close.isPending && onClose()}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Fechar o caixa {session.number}</DialogTitle>
            <DialogDescription>
              Conte e digite quanto tem de verdade. Deixe em branco o que não
              recebeu. O sistema compara depois.
            </DialogDescription>
          </DialogHeader>
          {methods.map((m) => (
            <Field
              key={m}
              label={paymentMethodLabel[m]}
              htmlFor={`count-${m}`}
              hint={hints[m]}
            >
              <MoneyInput
                id={`count-${m}`}
                autoFocus={m === 'cash'}
                value={counted[m]}
                onChange={(v) => {
                  setCounted((c) => ({ ...c, [m]: v }));
                  setError('');
                }}
              />
            </Field>
          ))}
          <Field label="Quem está fechando" htmlFor="close-operator">
            <Input
              id="close-operator"
              maxLength={60}
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
            />
          </Field>
          <Field label="Observação (opcional)" htmlFor="close-notes">
            <Textarea
              id="close-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Voltar
            </Button>
            <Button type="submit" disabled={close.isPending}>
              {close.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Lock />
              )}
              Conferir e fechar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Resultado do fechamento: esperado × contado em cada forma. */
function CloseResult({
  session,
  onDone,
}: {
  session: CashSession;
  onDone: () => void;
}) {
  const total = session.difference ? sum(session.difference) : 0;
  return (
    <Card className="mx-auto max-w-xl gap-5">
      <CardHeader className="items-center text-center">
        {total === 0 ? (
          <CheckCircle2 className="mx-auto size-12 text-free" />
        ) : (
          <AlertTriangle
            className={cn(
              'mx-auto size-12',
              total < 0 ? 'text-destructive' : 'text-busy',
            )}
          />
        )}
        <CardTitle className="text-xl">
          Caixa {session.number} fechado
        </CardTitle>
        <Difference cents={total} big />
      </CardHeader>
      <CardContent className="space-y-4">
        <SessionTable session={session} />
        {session.notes && (
          <p className="text-sm text-muted-foreground">“{session.notes}”</p>
        )}
        <Button size="lg" className="h-12 w-full" onClick={onDone}>
          Ok
        </Button>
      </CardContent>
    </Card>
  );
}

function SessionTable({ session }: { session: CashSession }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="py-2 text-left font-medium">Forma</th>
          <th className="py-2 text-right font-medium">Esperado</th>
          <th className="py-2 text-right font-medium">Contado</th>
          <th className="py-2 text-right font-medium">Diferença</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {methods.map((m) => (
          <tr key={m}>
            <td className="py-2">{paymentMethodLabel[m]}</td>
            <td className="py-2 text-right tabular">
              {formatCents(session.expected[m])}
            </td>
            <td className="py-2 text-right tabular">
              {session.counted ? formatCents(session.counted[m]) : '—'}
            </td>
            <td className="py-2 text-right">
              {session.difference && (
                <Difference cents={session.difference[m]} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="text-xs text-muted-foreground">
        <tr>
          <td colSpan={4} className="pt-3">
            Dinheiro esperado = troco {formatCents(session.openingFloatCents)} +
            recebido {formatCents(session.received.cash)} + suprimentos{' '}
            {formatCents(session.reinforcementsCents)} − sangrias{' '}
            {formatCents(session.withdrawalsCents)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function History() {
  const sessions = useQuery({
    queryKey: ['cash-history'],
    queryFn: () => api.cashSessions(15),
    refetchInterval: 30_000,
  });
  const [open, setOpen] = useState<CashSession | null>(null);
  const closed = (sessions.data ?? []).filter((s) => s.status === 'closed');
  if (closed.length === 0) return null;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Caixas anteriores</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {closed.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOpen(s)}
                className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-accent/40"
              >
                <span className="w-12 font-semibold tabular">#{s.number}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block">
                    {s.openedBy}
                    {s.closedBy &&
                      s.closedBy !== s.openedBy &&
                      ` → ${s.closedBy}`}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {time(s.openedAt)} até {s.closedAt && time(s.closedAt)}
                  </span>
                </span>
                {s.difference && <Difference cents={sum(s.difference)} />}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Caixa {open?.number}</DialogTitle>
            <DialogDescription>
              {open?.openedBy} · {open && time(open.openedAt)} até{' '}
              {open?.closedAt && time(open.closedAt)}
            </DialogDescription>
          </DialogHeader>
          {open && <SessionTable session={open} />}
          {open?.notes && (
            <p className="text-sm text-muted-foreground">“{open.notes}”</p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
