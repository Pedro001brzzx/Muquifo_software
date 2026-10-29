import type { Network } from '@muquifo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  Router,
  Smartphone,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { PageBody, PageHeader } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toastError } from '@/lib/errors';
import {
  formatMac,
  isAddressFixed,
  serverAddress,
  serverUrl,
  useNetwork,
} from '@/lib/network';
import { cn } from '@/lib/utils';

/** Onde a reserva costuma ficar em cada marca (o menu varia por modelo). */
const routerPaths: Record<string, string> = {
  'TP-Link':
    'Avançado → Rede → Servidor DHCP → Reserva de Endereço → Adicionar (em modelos antigos: DHCP → Reserva de Endereço)',
  Mercusys: 'Avançado → Rede → Servidor DHCP → Reserva de Endereço',
  Intelbras: 'Configurações → Rede (LAN) → Servidor DHCP → Reserva de IP',
  'D-Link': 'Configuração → Rede → Reserva DHCP',
  Tenda: 'Configurações avançadas → Servidor DHCP → Reserva de IP',
  Multilaser: 'Rede → DHCP → Reserva de IP',
  ASUS: 'Rede local (LAN) → Servidor DHCP → Atribuição manual',
  Xiaomi: 'Configurações avançadas → DHCP estático',
  Linksys: 'Conectividade → Rede local → Reservas DHCP',
  Netgear:
    'Avançado → Configuração → Configuração da LAN → Reserva de endereço',
};

/** Roteadores que as operadoras instalam: quase sempre com senha do técnico. */
const carrierBrands = new Set([
  'Huawei',
  'ZTE',
  'Nokia',
  'Fiberhome',
  'Sagemcom',
  'Askey',
  'MitraStar',
  'Arcadyan',
  'Elsys',
]);

/**
 * Celulares e tablets: QR para abrir o sistema no celular do garçom e o
 * passo a passo para o endereço não mudar (reserva no roteador).
 */
export function ConnectPage() {
  const network = useNetwork();
  const net = network.data;

  return (
    <>
      <PageHeader
        title="Celulares e tablets"
        description="Ligue os celulares dos garçons ao sistema e deixe o endereço fixo para nada parar de funcionar."
        actions={
          <Button variant="outline" asChild>
            <Link to="/qrcode">
              <QrCode /> QR do cardápio
            </Link>
          </Button>
        }
      />
      <PageBody>
        {!net ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-96 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        ) : !net.primary ? (
          <Card>
            <CardContent className="flex items-start gap-3 py-6">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <p>
                Este computador não está em nenhuma rede. Ligue o cabo ou o
                Wi-Fi do roteador do restaurante e abra esta tela de novo.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <AddressCard net={net} />
            <ConnectPhoneCard net={net} />
          </div>
        )}
      </PageBody>
    </>
  );
}

function usePublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.publishAddress,
    onSuccess: (net) => queryClient.setQueryData(queryKeys.network, net),
    onError: toastError,
  });
}

/** Situação do endereço e, se ainda pode mudar, o passo a passo para fixar. */
function AddressCard({ net }: { net: Network }) {
  const publish = usePublish();
  const current = net.addresses[0];
  const fixed = isAddressFixed(net);
  const [showGuide, setShowGuide] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Router className="size-5 text-muted-foreground" /> Endereço do
          sistema
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {net.pendingChange && <PendingChange net={net} />}
        {net.addressChanged ? (
          <Status tone="bad" title="O endereço do sistema mudou">
            <p>
              Os QR codes impressos e os celulares ainda usam{' '}
              <b className="font-mono">{net.publishedAddress}</b>, mas agora
              este computador é <b className="font-mono">{current}</b>. Por isso
              eles não abrem o sistema.
            </p>
            <Button
              className="mt-3"
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate(
                  { address: current },
                  {
                    onSuccess: () =>
                      toast.success(
                        'Pronto. Reimprima os QR codes e escaneie de novo nos celulares.',
                      ),
                  },
                )
              }
            >
              {publish.isPending && <Loader2 className="animate-spin" />}
              Usar {current} daqui pra frente
            </Button>
            <p className="mt-2 text-xs">
              Depois, reserve o endereço no roteador (abaixo) para não acontecer
              de novo.
            </p>
          </Status>
        ) : fixed ? (
          <Status tone="good" title={`Endereço fixo: ${current}`}>
            {net.addressReserved
              ? 'Reservado no roteador (confirmado por você). Os QR codes e os celulares continuam funcionando mesmo depois de reiniciar.'
              : 'Configurado como fixo neste computador.'}
          </Status>
        ) : (
          <Status tone="warn" title="Falta fixar o endereço">
            Hoje o roteador empresta o endereço{' '}
            <b className="font-mono">{current}</b> para este computador e pode
            trocar depois de uma queda de luz ou de reiniciar. Aí os QR codes e
            os celulares param. Reserve uma vez e esqueça: leva uns 5 minutos.
          </Status>
        )}

        {fixed && !showGuide ? (
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowGuide(true)}
          >
            <ChevronDown className="size-4" /> Ver o passo a passo da reserva
          </button>
        ) : (
          <RouterGuide net={net} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * O roteador trocou o IP e o servidor já passou a usar o novo: o sistema
 * funciona, mas o que foi impresso ou salvo com o IP antigo parou.
 */
function PendingChange({ net }: { net: Network }) {
  const queryClient = useQueryClient();
  const change = net.pendingChange!;
  const ack = useMutation({
    mutationFn: api.acknowledgeAddressChange,
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.network, saved),
    onError: toastError,
  });
  const when = new Date(change.at).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Status tone="bad" title="O endereço mudou e o sistema já se ajustou">
      <p>
        Em {when} o roteador trocou o endereço de{' '}
        <b className="font-mono">{change.from}</b> para{' '}
        <b className="font-mono">{change.to}</b>. O sistema continua funcionando
        no endereço novo, mas o que tinha o antigo parou:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>reimprima os QR codes do cardápio;</li>
        <li>
          nos celulares, escaneie o código ao lado de novo e refaça o atalho.
        </li>
      </ul>
      {change.wasReserved && (
        <p className="mt-2">
          A reserva no roteador não funcionou: confira se o MAC e o IP do passo
          3 estão iguais aos salvos lá.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/qrcode">
            <QrCode /> Imprimir QR codes novos
          </Link>
        </Button>
        <Button
          variant="outline"
          disabled={ack.isPending}
          onClick={() => ack.mutate()}
        >
          <Check /> Entendi, já refiz
        </Button>
      </div>
    </Status>
  );
}

function Status({
  tone,
  title,
  children,
}: {
  tone: 'good' | 'warn' | 'bad';
  title: string;
  children: ReactNode;
}) {
  const Icon = tone === 'good' ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-xl border p-4',
        tone === 'good' && 'border-free/40 bg-free/10',
        tone === 'warn' && 'border-busy/40 bg-busy/10',
        tone === 'bad' && 'border-destructive/40 bg-destructive/10',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-5 shrink-0',
          tone === 'good' && 'text-free',
          tone === 'warn' && 'text-busy',
          tone === 'bad' && 'text-destructive',
        )}
      />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-base">{title}</p>
        <div className="mt-1 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/**
 * Reserva DHCP: o roteador passa a dar sempre o mesmo IP para este
 * computador. Os dados que o roteador pede já vêm preenchidos.
 */
function RouterGuide({ net }: { net: Network }) {
  const publish = usePublish();
  const primary = net.primary!;
  const address = net.addresses[0];
  const brand = primary.router;
  const carrier = brand !== null && carrierBrands.has(brand);
  const path = brand ? routerPaths[brand] : undefined;

  return (
    <ol className="space-y-5">
      <Step n={1} title="Entre na página do roteador">
        {primary.gateway ? (
          <Button variant="outline" size="sm" className="my-1" asChild>
            <a
              href={`http://${primary.gateway}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink /> Abrir {primary.gateway}
            </a>
          </Button>
        ) : (
          <p>
            Costuma ser <span className="font-mono">http://192.168.0.1</span> ou{' '}
            <span className="font-mono">http://192.168.1.1</span>.
          </p>
        )}
        <p>
          O usuário e a senha costumam estar na etiqueta embaixo do roteador.
          {carrier || brand === null
            ? ' Se o roteador é da operadora (Vivo, Claro, Oi, TIM...), ligue no suporte e peça uma "reserva de IP (DHCP) para o computador do caixa", passando os dados do passo 3.'
            : ''}
        </p>
      </Step>

      <Step n={2} title="Procure a reserva de endereço">
        {brand && (
          <p>
            Seu roteador parece ser <b>{brand}</b>.
            {path ? (
              <>
                {' '}
                Costuma ficar em: <b>{path}</b>.
              </>
            ) : carrier ? (
              <>
                {' '}
                Costuma ficar em: <b>Rede local (LAN) → DHCP → IP estático</b>.
              </>
            ) : null}
          </p>
        )}
        <p>
          O nome muda de roteador para roteador: "Reserva de endereço", "Address
          Reservation", "DHCP estático", "IP fixo" ou "Vincular IP e MAC". Quase
          sempre fica dentro de <b>DHCP</b> ou <b>LAN</b>.
        </p>
      </Step>

      <Step n={3} title="Cadastre este computador">
        <dl className="my-1 grid gap-2">
          {primary.mac && (
            <CopyRow label="Endereço MAC" value={formatMac(primary.mac)} />
          )}
          <CopyRow label="Endereço IP" value={address} />
          <CopyRow label="Nome (se pedir)" value="Muquifo" />
        </dl>
        {!primary.mac && (
          <p>
            O roteador costuma listar os aparelhos conectados: escolha o que
            está com o IP acima.
          </p>
        )}
      </Step>

      <Step n={4} title="Salve e confirme aqui">
        <p>
          Salve no roteador. Se ele pedir para reiniciar, pode reiniciar: o
          sistema volta sozinho.
        </p>
        {net.addressReserved && !net.addressChanged ? (
          <p className="flex items-center gap-1.5 font-medium text-free">
            <Check className="size-4" /> Reserva confirmada.
          </p>
        ) : (
          <Button
            className="mt-2"
            disabled={publish.isPending}
            onClick={() =>
              publish.mutate(
                { address, reserved: true },
                { onSuccess: () => toast.success('Endereço fixo confirmado') },
              )
            }
          >
            {publish.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Check />
            )}
            Pronto, reservei
          </Button>
        )}
      </Step>
    </ol>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 text-sm text-muted-foreground">
        <p className="pt-0.5 font-semibold text-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}

function copy(value: string) {
  // navigator.clipboard só existe em HTTPS/localhost; pelo IP da rede, avisa.
  if (!navigator.clipboard) {
    toast.info(`Anote: ${value}`);
    return;
  }
  void navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`Copiado: ${value}`));
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <dt className="text-xs">{label}</dt>
        <dd className="font-mono text-base font-semibold text-foreground">
          {value}
        </dd>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Copiar ${label}`}
        onClick={() => copy(value)}
      >
        <Copy />
      </Button>
    </div>
  );
}

/** QR que abre o sistema no celular e o atalho na tela inicial. */
function ConnectPhoneCard({ net }: { net: Network }) {
  const address = serverAddress(net)!;
  const url = serverUrl(address);
  const fixed = isAddressFixed(net);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5 text-muted-foreground" /> Conectar um
          celular
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-2xl border bg-white p-3">
            <QRCodeSVG value={url} size={200} marginSize={1} level="M" />
          </div>
          <button
            type="button"
            className="font-mono text-lg font-semibold"
            onClick={() => copy(url)}
          >
            {url.replace(/\/$/, '')}
          </button>
        </div>

        {!fixed && (
          <p className="flex items-start gap-2 rounded-lg bg-busy/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-busy" />
            Fixe o endereço antes (ao lado). Senão, o atalho no celular pode
            parar de abrir.
          </p>
        )}

        <ol className="space-y-5">
          <Step n={1} title="Conecte o celular no Wi-Fi do restaurante">
            <p>Com os dados móveis (4G) ele não acha o sistema.</p>
          </Step>
          <Step n={2} title="Aponte a câmera para o código">
            <p>Toque no link que aparecer. O sistema abre no navegador.</p>
          </Step>
          <Step n={3} title="Crie o atalho na tela inicial">
            <Tabs
              defaultValue={
                /iphone|ipad/i.test(navigator.userAgent) ? 'ios' : 'android'
              }
            >
              <TabsList>
                <TabsTrigger value="android">Android</TabsTrigger>
                <TabsTrigger value="ios">iPhone</TabsTrigger>
              </TabsList>
              <TabsContent value="android" className="pt-1">
                No Chrome, toque nos <b>três pontinhos ⋮</b> no canto de cima e
                em <b>Adicionar à tela inicial</b>. O Muquifo vira um ícone,
                como um aplicativo.
              </TabsContent>
              <TabsContent value="ios" className="pt-1">
                No Safari, toque em <b>Compartilhar</b> (quadrado com seta para
                cima) e em <b>Adicionar à Tela de Início</b>. O Muquifo vira um
                ícone, como um aplicativo.
              </TabsContent>
            </Tabs>
          </Step>
        </ol>
      </CardContent>
    </Card>
  );
}
