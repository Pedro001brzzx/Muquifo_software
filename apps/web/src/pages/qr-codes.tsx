import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Printer,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { Field } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toastError } from '@/lib/errors';
import { tableLabel } from '@/lib/format';
import {
  isAddressFixed,
  serverAddress,
  serverUrl,
  useNetwork,
} from '@/lib/network';

const isLocal = (host: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(host) ||
  host.endsWith('.localhost');

/**
 * QR codes do cardápio: um geral (balcão, cartaz) e um por mesa, prontos
 * para imprimir. O link usa o IP da rede para o celular do cliente abrir.
 */
export function QrCodesPage() {
  const network = useNetwork();
  const queryClient = useQueryClient();
  const tables = useQuery({ queryKey: queryKeys.tables, queryFn: api.tables });
  const [base, setBase] = useState('');
  const [view, setView] = useState<'general' | 'tables'>('general');

  // Usa o IP publicado (o que os celulares conhecem). Aberto no próprio
  // computador (localhost), o celular não alcançaria o link.
  useEffect(() => {
    if (base || network.isLoading) return;
    const ip = serverAddress(network.data);
    if (ip) return setBase(serverUrl(ip, ''));
    if (!isLocal(location.hostname)) setBase(location.origin);
  }, [base, network.isLoading, network.data]);

  /** Imprimir fixa este IP como o dos QR codes, para avisar se ele mudar. */
  const print = () => {
    const host = (() => {
      try {
        return new URL(clean).hostname;
      } catch {
        return '';
      }
    })();
    const net = network.data;
    if (net?.addresses.includes(host) && net.publishedAddress !== host) {
      void api
        .publishAddress({ address: host })
        .then((saved) => queryClient.setQueryData(queryKeys.network, saved))
        .catch(() => undefined);
    }
    window.print();
  };

  const clean = base.replace(/\/+$/, '');
  const link = (mesa?: number) =>
    `${clean}/cardapio${mesa ? `?mesa=${mesa}` : ''}`;
  const stillLocal = (() => {
    try {
      return isLocal(new URL(clean).hostname);
    } catch {
      return true;
    }
  })();
  const active = (tables.data ?? [])
    .filter((t) => t.active)
    .sort((a, b) => a.number - b.number);

  return (
    <div className="min-h-dvh bg-background print:bg-white print:text-black">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 md:py-8 print:hidden">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link to="/produtos">
            <ArrowLeft /> Voltar
          </Link>
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              QR Code do cardápio
            </h1>
            <p className="mt-1 max-w-xl text-muted-foreground">
              O cliente aponta a câmera do celular e vê o cardápio com preços,
              ingredientes e o que acabou. Precisa estar no Wi-Fi do
              restaurante.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tabs
              value={view}
              onValueChange={(v) => setView(v as 'general' | 'tables')}
            >
              <TabsList>
                <TabsTrigger value="general">Um para todos</TabsTrigger>
                <TabsTrigger value="tables">
                  Um por mesa ({active.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={print} disabled={stillLocal}>
              <Printer /> Imprimir
            </Button>
          </div>
        </div>

        <RestaurantCard />

        {stillLocal && (
          <div className="flex items-start gap-3 rounded-xl border border-busy/40 bg-busy/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-busy" />
            <p>
              O endereço abaixo só funciona neste computador. Abra o sistema
              pelo endereço da rede (ex.: http://192.168.0.10:3000) ou escreva-o
              abaixo.
            </p>
          </div>
        )}

        {!stillLocal && network.data && !isAddressFixed(network.data) && (
          <div className="flex items-start gap-3 rounded-xl border border-busy/40 bg-busy/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-busy" />
            <p>
              Antes de imprimir, fixe o endereço do sistema no roteador. Se ele
              mudar, os QR codes impressos param de abrir.{' '}
              <Link
                to="/conectar"
                className="font-medium text-primary underline"
              >
                Fixar agora
              </Link>
            </p>
          </div>
        )}

        <details className="rounded-xl border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Endereço usado no QR:{' '}
            <span className="font-mono">{clean || '…'}</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field
              label="Endereço do sistema na rede"
              htmlFor="qr-base"
              hint={
                network.data?.addresses.length
                  ? `IPs desta máquina: ${network.data.addresses.join(', ')}`
                  : undefined
              }
            >
              <Input
                id="qr-base"
                className="font-mono"
                value={base}
                onChange={(e) => setBase(e.target.value.trim())}
              />
            </Field>
          </div>
        </details>
      </div>

      {view === 'general' ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pb-10 text-center print:max-w-none print:pt-16">
          <QrCard
            url={link()}
            title="Cardápio"
            subtitle="Aponte a câmera do celular"
            big
          />
          <div className="flex flex-wrap justify-center gap-2 print:hidden">
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(link())
                  .then(() => toast.success('Link copiado'))
              }
            >
              <Copy /> Copiar link
            </Button>
            <Button variant="outline" asChild>
              <a href={link()} target="_blank" rel="noreferrer">
                <ExternalLink /> Abrir cardápio
              </a>
            </Button>
          </div>
        </div>
      ) : active.length === 0 ? (
        <p className="px-4 pb-10 text-center text-muted-foreground print:hidden">
          Nenhuma mesa cadastrada.{' '}
          <Link to="/comecar" className="text-primary underline">
            Cadastrar mesas
          </Link>
        </p>
      ) : (
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 px-4 pb-10 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-6">
          {active.map((t) => (
            <QrCard
              key={t.id}
              url={link(t.number)}
              title={`Mesa ${tableLabel(t.number)}`}
              subtitle="Cardápio"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Nome, frase e aviso que o cliente vê no topo do cardápio. */
function RestaurantCard() {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: queryKeys.restaurant,
    queryFn: api.restaurant,
  });
  const [draft, setDraft] = useState<{
    name: string;
    tagline: string;
    notice: string;
  } | null>(null);
  const data = current.data;
  const form = draft ?? {
    name: data?.name ?? '',
    tagline: data?.tagline ?? '',
    notice: data?.notice ?? '',
  };
  const set = (field: keyof typeof form) => (value: string) =>
    setDraft({ ...form, [field]: value });

  const save = useMutation({
    mutationFn: () =>
      api.updateRestaurant({
        version: data?.version ?? 0,
        name: form.name,
        tagline: form.tagline,
        notice: form.notice,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.restaurant, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.publicMenu });
      setDraft(null);
      toast.success('Cardápio atualizado');
    },
    onError: (error) => {
      void current.refetch();
      toastError(error);
    },
  });

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h2 className="font-semibold">Topo do cardápio</h2>
        <p className="text-sm text-muted-foreground">
          O que o cliente lê primeiro ao abrir o cardápio no celular.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do restaurante" htmlFor="r-name">
          <Input
            id="r-name"
            maxLength={60}
            placeholder="Ex.: Lanchonete do Zé"
            value={form.name}
            disabled={!data}
            onChange={(e) => set('name')(e.target.value)}
          />
        </Field>
        <Field label="Frase (opcional)" htmlFor="r-tagline">
          <Input
            id="r-tagline"
            maxLength={80}
            placeholder="Ex.: Lanches e pizzas desde 1998"
            value={form.tagline}
            disabled={!data}
            onChange={(e) => set('tagline')(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Aviso em destaque (opcional)" htmlFor="r-notice">
            <Input
              id="r-notice"
              maxLength={200}
              placeholder="Ex.: Cozinha fecha às 23h · Wi-Fi: muquifo123"
              value={form.notice}
              disabled={!data}
              onChange={(e) => set('notice')(e.target.value)}
            />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {draft && (
          <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
            Desfazer
          </Button>
        )}
        <Button type="submit" disabled={!draft || save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
          Salvar
        </Button>
      </div>
    </form>
  );
}

/** Cartão para recortar: título, QR e instrução. Sempre branco para imprimir e ler bem. */
function QrCard({
  url,
  title,
  subtitle,
  big,
}: {
  url: string;
  title: string;
  subtitle: string;
  big?: boolean;
}) {
  return (
    <div className="flex break-inside-avoid flex-col items-center gap-2 rounded-2xl border bg-white p-4 text-center text-black print:border-black/30">
      <span className={big ? 'text-2xl font-bold' : 'text-lg font-bold'}>
        {title}
      </span>
      <QRCodeSVG
        value={url}
        size={big ? 260 : 150}
        marginSize={1}
        level="M"
        className="h-auto w-full max-w-[260px]"
      />
      <span className="text-sm text-neutral-600">{subtitle}</span>
    </div>
  );
}
