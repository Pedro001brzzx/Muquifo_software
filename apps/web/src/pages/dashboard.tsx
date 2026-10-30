import {
  type Dashboard,
  type PaymentMethod,
  paymentMethodLabel,
} from '@muquifo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Lock,
  type LucideIcon,
  Undo2,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '@/api';
import { PageBody, PageHeader } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

const methods: PaymentMethod[] = ['cash', 'credit', 'debit', 'pix'];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDay = (day: string, delta: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + delta));
};
const hourMinute = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

/** Painel do dono: como foi o dia e o que merece atenção. */
export function DashboardPage() {
  const today = isoDay(new Date());
  const [day, setDay] = useState(today);
  const data = useQuery({
    queryKey: queryKeys.dashboard(day),
    queryFn: () => api.dashboard(day),
    refetchInterval: day === today ? 30_000 : false,
  });
  const d = data.data;
  const label =
    day === today
      ? 'Hoje'
      : new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
        });

  return (
    <>
      <PageHeader
        title="Painel"
        description={label}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Dia anterior"
              onClick={() => setDay(shiftDay(day, -1))}
            >
              <ChevronLeft />
            </Button>
            <Input
              type="date"
              aria-label="Dia"
              className="w-40"
              value={day}
              max={today}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Próximo dia"
              disabled={day >= today}
              onClick={() => setDay(shiftDay(day, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-6">
        {!d ? (
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <Attention d={d} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Vendas"
                value={formatCents(d.salesCents)}
                foot={
                  <Compare now={d.salesCents} before={d.lastWeekSalesCents} />
                }
              />
              <Stat
                label="Ticket médio"
                value={formatCents(d.averageTicketCents)}
                foot={`${d.tabCount} ${d.tabCount === 1 ? 'conta atendida' : 'contas atendidas'}`}
              />
              <Stat
                label="Pedidos enviados"
                value={String(d.orderCount)}
                foot="para a cozinha e o bar"
              />
              <Stat
                label="Contas abertas agora"
                value={String(d.openTabs.count)}
                foot={`${formatCents(d.openTabs.totalCents)} a receber`}
              />
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <HourChart byHour={d.byHour} />
              <Received received={d.received} />
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <TopProducts products={d.topProducts} />
              <CashCard d={d} />
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

function Stat({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot: ReactNode;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight tabular">{value}</p>
        <p className="text-xs text-muted-foreground">{foot}</p>
      </CardContent>
    </Card>
  );
}

function Compare({ now, before }: { now: number; before: number }) {
  if (before === 0) return <>sem vendas no mesmo dia da semana passada</>;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <span>
      <span
        className={cn(
          'font-medium',
          pct >= 0 ? 'text-free' : 'text-destructive',
        )}
      >
        {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%
      </span>{' '}
      que na semana passada ({formatCents(before)})
    </span>
  );
}

/** Possíveis desvios do dia, cada um com ícone e texto (não só cor). */
function Attention({ d }: { d: Dashboard }) {
  const a = d.attention;
  const rows: {
    icon: LucideIcon;
    title: string;
    detail: string;
    items: { key: string; text: string; value?: string }[];
  }[] = [];
  if (a.cashDifferences.length) {
    rows.push({
      icon: Wallet,
      title: `${a.cashDifferences.length} ${a.cashDifferences.length === 1 ? 'caixa fechou' : 'caixas fecharam'} com diferença`,
      detail: 'Dinheiro ou maquininha não bateu com o sistema.',
      items: a.cashDifferences.map((c) => ({
        key: `c${c.number}`,
        text: `Caixa ${c.number} · fechado por ${c.closedBy} às ${hourMinute(c.closedAt)}`,
        value: `${c.differenceCents < 0 ? 'faltou' : 'sobrou'} ${formatCents(Math.abs(c.differenceCents))}`,
      })),
    });
  }
  if (a.canceledItems.count) {
    rows.push({
      icon: Ban,
      title: `${a.canceledItems.count} ${a.canceledItems.count === 1 ? 'item cancelado' : 'itens cancelados'} depois de enviado`,
      detail: `${formatCents(a.canceledItems.totalCents)} que saíram da conta depois de ir para a cozinha.`,
      items: a.canceledItems.recent.map((c, i) => ({
        key: `i${i}`,
        text: `${hourMinute(c.at)} · comanda ${c.tabCode} · ${c.productName}${c.reason ? ` — “${c.reason}”` : ''}`,
        value: formatCents(c.totalCents),
      })),
    });
  }
  if (a.refunds.count) {
    rows.push({
      icon: Undo2,
      title: `${a.refunds.count} ${a.refunds.count === 1 ? 'estorno' : 'estornos'} de pagamento`,
      detail: `${formatCents(a.refunds.totalCents)} devolvidos ao saldo das contas.`,
      items: a.refunds.recent.map((r, i) => ({
        key: `r${i}`,
        text: `${hourMinute(r.at)} · comanda ${r.tabCode} · ${paymentMethodLabel[r.method as PaymentMethod] ?? r.method}${r.reason ? ` — “${r.reason}”` : ''}`,
        value: formatCents(r.amountCents),
      })),
    });
  }
  if (a.releasedTabs.count) {
    rows.push({
      icon: DoorOpen,
      title: `${a.releasedTabs.count} ${a.releasedTabs.count === 1 ? 'mesa liberada' : 'mesas liberadas'} sem consumo`,
      detail: 'Comandas abertas e canceladas sem venda.',
      items: a.releasedTabs.recent.map((r, i) => ({
        key: `t${i}`,
        text: `${hourMinute(r.at)} · comanda ${r.tabCode} — “${r.reason}”`,
      })),
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-free/40 bg-free/10 p-4">
        <CheckCircle2 className="size-6 shrink-0 text-free" />
        <div>
          <p className="font-semibold">Nada fora do normal</p>
          <p className="text-sm text-muted-foreground">
            Sem cancelamentos depois de enviar, estornos, mesas liberadas ou
            diferença de caixa.
          </p>
        </div>
      </div>
    );
  }
  return (
    <Card className="gap-3 border-busy/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-busy" /> Pontos de atenção
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <details key={r.title} className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
              <r.icon className="size-5 shrink-0 text-busy" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{r.title}</span>
                <span className="block text-sm text-muted-foreground">
                  {r.detail}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-90" />
            </summary>
            <ul className="divide-y border-t px-3">
              {r.items.map((it) => (
                <li
                  key={it.key}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">{it.text}</span>
                  {it.value && (
                    <span className="shrink-0 font-medium tabular">
                      {it.value}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

/** Vendas por hora: barras de uma série só, com valor ao passar o dedo/mouse. */
function HourChart({ byHour }: { byHour: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const active = byHour.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
  // Mostra do primeiro ao último horário com venda (mínimo 11h–23h).
  const start = Math.min(11, ...active);
  const end = Math.max(23, ...active);
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const max = Math.max(...byHour, 1);
  const shown = hover ?? byHour.indexOf(Math.max(...byHour));

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Vendas por hora</CardTitle>
        <p className="text-sm text-muted-foreground tabular">
          {byHour[shown] > 0
            ? `${String(shown).padStart(2, '0')}h · ${formatCents(byHour[shown])}${hover === null ? ' (melhor horário)' : ''}`
            : 'Sem vendas ainda.'}
        </p>
      </CardHeader>
      <CardContent>
        <div
          className="flex h-44 items-end gap-0.5 border-b"
          onMouseLeave={() => setHover(null)}
        >
          {hours.map((h) => (
            <button
              key={h}
              type="button"
              aria-label={`${h}h: ${formatCents(byHour[h])}`}
              onMouseEnter={() => setHover(h)}
              onFocus={() => setHover(h)}
              onClick={() => setHover(h)}
              className="flex h-full flex-1 items-end"
            >
              <span
                className={cn(
                  'block w-full rounded-t-[4px] bg-primary/80 transition-colors',
                  hover === h && 'bg-primary',
                  byHour[h] === 0 && 'bg-transparent',
                )}
                style={{ height: `${(byHour[h] / max) * 100}%` }}
              />
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-0.5 text-[10px] text-muted-foreground tabular">
          {hours.map((h) => (
            <span key={h} className="flex-1 text-center">
              {h % 3 === 0 ? `${h}h` : ''}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Recebido por forma: barras horizontais com o valor escrito. */
function Received({ received }: { received: Dashboard['received'] }) {
  const total = methods.reduce((s, m) => s + received[m], 0);
  const max = Math.max(...methods.map((m) => received[m]), 1);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Recebido</CardTitle>
        <p className="text-sm text-muted-foreground tabular">
          {formatCents(total)} no dia
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {methods.map((m) => (
          <div key={m} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{paymentMethodLabel[m]}</span>
              <span className="font-medium tabular">
                {formatCents(received[m])}
                {total > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {Math.round((received[m] / total) * 100)}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${(received[m] / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TopProducts({ products }: { products: Dashboard['topProducts'] }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Mais vendidos</CardTitle>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma venda no dia.</p>
        ) : (
          <ol className="divide-y">
            {products.map((p, i) => (
              <li key={p.name} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-5 text-muted-foreground tabular">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {p.name}
                </span>
                <span className="text-muted-foreground tabular">
                  {p.quantity.toLocaleString('pt-BR')}×
                </span>
                <span className="w-24 text-right font-semibold tabular">
                  {formatCents(p.totalCents)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Caixa atual visto pelo dono: aqui os totais esperados aparecem. */
function CashCard({ d }: { d: Dashboard }) {
  const s = d.cash;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-5" /> Caixa agora
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!s ? (
          <>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" /> Caixa fechado.
            </p>
            <Button variant="outline" asChild>
              <Link to="/caixa">Ir para o caixa</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Caixa {s.number} aberto por {s.openedBy} às{' '}
              {hourMinute(s.openedAt)} · {s.paymentCount} pagamentos
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {methods.map((m) => (
                <div key={m} className="rounded-lg bg-muted/50 p-2.5">
                  <dt className="text-muted-foreground">
                    {m === 'cash'
                      ? 'Dinheiro na gaveta'
                      : paymentMethodLabel[m]}
                  </dt>
                  <dd className="font-semibold tabular">
                    {/* O painel é só do dono, que sempre recebe o esperado. */}
                    {s.expected ? formatCents(s.expected[m]) : '—'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Esses valores não aparecem na tela do Caixa: quem fecha conta sem
              saber o esperado.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
