import {
  type ApiError,
  errorCodes,
  type LoginUser,
  type Session,
  type SetupResult,
  userRoleLabel,
} from '@muquifo/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  UtensilsCrossed,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, api, queryKeys } from '@/api';
import { Avatar } from '@/components/avatar';
import { PinPad } from '@/components/pin-pad';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** Mensagem do erro de PIN, com tentativas restantes ou tempo de bloqueio. */
function pinError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Erro inesperado.';
  if (error.status === 0) return 'Sem conexão com o servidor.';
  if (error.code === errorCodes.invalidPin) {
    const left = (error.body?.details as { attemptsLeft?: number })
      ?.attemptsLeft;
    return left !== undefined && left <= 3
      ? `PIN incorreto. ${left === 1 ? 'Resta 1 tentativa' : `Restam ${left} tentativas`}.`
      : 'PIN incorreto.';
  }
  return error.message;
}

/**
 * Entrada do aparelho: toca no nome e digita o PIN. Sem ninguém cadastrado,
 * o computador do servidor cria o primeiro dono.
 */
export function LoginScreen() {
  const status = useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: api.authStatus,
  });
  const [picked, setPicked] = useState<LoginUser | null>(null);
  const [recovering, setRecovering] = useState(false);

  let content: ReactNode;
  if (status.isPending) {
    content = (
      <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
    );
  } else if (status.isError) {
    content = (
      <div className="space-y-4 text-center">
        <p className="text-muted-foreground">
          Sem conexão com o servidor do Muquifo. Confira se o computador do
          caixa está ligado e se este aparelho está no Wi-Fi do restaurante.
        </p>
        <Button onClick={() => void status.refetch()}>Tentar de novo</Button>
      </div>
    );
  } else if (status.data.setupRequired) {
    content = status.data.canSetup ? (
      <SetupFlow />
    ) : (
      <div className="space-y-3 text-center">
        <MonitorSmartphone className="mx-auto size-10 text-muted-foreground" />
        <p className="font-semibold">O Muquifo ainda não foi configurado.</p>
        <p className="text-muted-foreground">
          Abra o Muquifo no computador onde ele foi instalado para cadastrar o
          dono. Depois os celulares entram aqui.
        </p>
      </div>
    );
  } else if (picked && recovering) {
    content = <RecoverStep user={picked} onBack={() => setRecovering(false)} />;
  } else if (picked) {
    content = (
      <PinStep
        user={picked}
        onBack={() => setPicked(null)}
        onForgot={() => setRecovering(true)}
      />
    );
  } else {
    content = (
      <div className="space-y-5">
        <h1 className="text-center text-xl font-semibold">Quem é você?</h1>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {status.data.users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => setPicked(u)}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center transition hover:bg-accent active:scale-[0.98]"
              >
                <Avatar user={u} />
                <span className="line-clamp-2 font-semibold leading-tight">
                  {u.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {userRoleLabel[u.role]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-center gap-2.5 px-4 pt-8 pb-4">
        <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <UtensilsCrossed className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">Muquifo</span>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-4 pb-10">
        {content}
      </main>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-2" onClick={onClick}>
      <ArrowLeft /> Voltar
    </Button>
  );
}

function PinStep({
  user,
  onBack,
  onForgot,
}: {
  user: LoginUser;
  onBack: () => void;
  onForgot: () => void;
}) {
  const { signIn } = useAuth();
  const [pin, setPin] = useState('');
  const login = useMutation({
    mutationFn: () => api.login({ userId: user.id, pin }),
    onSuccess: signIn,
    onError: () => setPin(''),
  });

  return (
    <div className="space-y-6">
      <BackButton onClick={onBack} />
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar user={user} size="lg" />
        <p className="text-xl font-semibold">{user.name}</p>
      </div>
      <PinPad
        value={pin}
        onChange={(v) => {
          setPin(v);
          if (login.isError) login.reset();
        }}
        onSubmit={() => login.mutate()}
        busy={login.isPending}
        error={login.isError ? pinError(login.error) : null}
      />
      <p className="text-center text-sm text-muted-foreground">
        {user.role === 'owner' ? (
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={onForgot}
          >
            Esqueci meu PIN
          </button>
        ) : (
          'Esqueceu o PIN? O dono troca em Cadastros › Equipe.'
        )}
      </p>
    </div>
  );
}

/** Dono que esqueceu o PIN: código de recuperação + PIN novo duas vezes. */
function RecoverStep({
  user,
  onBack,
}: {
  user: LoginUser;
  onBack: () => void;
}) {
  const { signIn } = useAuth();
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'code' | 'pin' | 'confirm'>('code');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const recover = useMutation({
    mutationFn: () => api.recover({ userId: user.id, recoveryCode: code, pin }),
    onSuccess: (session: Session) => {
      toast.success('PIN trocado');
      signIn(session);
    },
    onError: () => {
      setStep('code');
      setPin('');
      setConfirm('');
    },
  });

  return (
    <div className="space-y-6">
      <BackButton onClick={onBack} />
      <div className="space-y-1 text-center">
        <KeyRound className="mx-auto size-8 text-primary" />
        <p className="text-xl font-semibold">Trocar o PIN de {user.name}</p>
      </div>
      {step === 'code' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            recover.reset();
            setStep('pin');
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="recovery">Código de recuperação</Label>
            <Input
              id="recovery"
              autoFocus
              autoComplete="off"
              placeholder="XXXX-XXXX-XXXX"
              className="h-12 text-center font-mono text-lg tracking-widest uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              É o código que apareceu quando o Muquifo foi configurado.
            </p>
          </div>
          {recover.isError && (
            <p className="text-sm text-destructive" role="alert">
              {pinError(recover.error)}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={code.trim().length < 12}
          >
            Continuar
          </Button>
        </form>
      ) : step === 'pin' ? (
        <>
          <p className="text-center font-medium">Escolha o PIN novo</p>
          <PinPad
            value={pin}
            onChange={setPin}
            onSubmit={() => setStep('confirm')}
            submitLabel="Continuar"
          />
        </>
      ) : (
        <>
          <p className="text-center font-medium">Digite o PIN novo de novo</p>
          <PinPad
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              setMismatch(false);
            }}
            onSubmit={() => {
              if (confirm !== pin) {
                setMismatch(true);
                setConfirm('');
                return;
              }
              recover.mutate();
            }}
            busy={recover.isPending}
            error={mismatch ? 'Os PINs não são iguais.' : null}
            submitLabel="Trocar PIN"
          />
        </>
      )}
    </div>
  );
}

/**
 * Primeiro acesso (só no computador do servidor): nome e PIN do dono, depois
 * o código de recuperação, mostrado uma única vez.
 */
function SetupFlow() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<'name' | 'pin' | 'confirm' | 'code'>('name');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [noted, setNoted] = useState(false);
  const setup = useMutation({
    mutationFn: () => api.setup({ name, pin }),
    onSuccess: (r) => {
      setResult(r);
      setStep('code');
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiRequestError
          ? ((error.body as ApiError | null)?.message ?? error.message)
          : 'Erro inesperado',
      );
      setStep('pin');
      setPin('');
      setConfirm('');
    },
  });

  if (step === 'name') {
    return (
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setStep('pin');
        }}
      >
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Bem-vindo ao Muquifo</h1>
          <p className="text-muted-foreground">
            Primeiro, o cadastro do dono. Cada pessoa da equipe vai entrar com o
            próprio PIN, e tudo fica registrado em nome de quem fez.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="owner-name">Seu nome</Label>
          <Input
            id="owner-name"
            autoFocus
            maxLength={40}
            className="h-12 text-lg md:text-lg"
            placeholder="Ex.: Pedro"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={!name.trim()}
        >
          Continuar
        </Button>
      </form>
    );
  }

  if (step === 'pin' || step === 'confirm') {
    const confirming = step === 'confirm';
    return (
      <div className="space-y-6">
        <BackButton
          onClick={() => {
            setStep(confirming ? 'pin' : 'name');
            setConfirm('');
            setMismatch(false);
          }}
        />
        <div className="space-y-1 text-center">
          <p className="text-xl font-semibold">
            {confirming
              ? 'Digite o PIN de novo'
              : `${name.trim()}, escolha seu PIN`}
          </p>
          {!confirming && (
            <p className="text-sm text-muted-foreground">
              Ele autoriza cancelamentos e estornos da equipe. Não use datas
              óbvias.
            </p>
          )}
        </div>
        <PinPad
          value={confirming ? confirm : pin}
          onChange={(v) => {
            if (confirming) {
              setConfirm(v);
              setMismatch(false);
            } else setPin(v);
          }}
          onSubmit={() => {
            if (!confirming) return setStep('confirm');
            if (confirm !== pin) {
              setMismatch(true);
              setConfirm('');
              return;
            }
            setup.mutate();
          }}
          busy={setup.isPending}
          error={mismatch ? 'Os PINs não são iguais.' : null}
          submitLabel={confirming ? 'Criar' : 'Continuar'}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 text-center">
      <KeyRound className="mx-auto size-10 text-primary" />
      <h1 className="text-2xl font-semibold">Guarde este código</h1>
      <p className="text-muted-foreground">
        Se você esquecer o PIN, é com ele que troca. Ele aparece{' '}
        <b className="text-foreground">só agora</b>: anote num papel e guarde
        longe do caixa.
      </p>
      <button
        type="button"
        className="mx-auto flex items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-primary/5 px-6 py-4 font-mono text-3xl font-bold tracking-widest"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(result!.recoveryCode)
            .then(() => toast.success('Código copiado'))
        }
      >
        {result!.recoveryCode}
        <Copy className="size-5 text-muted-foreground" />
      </button>
      <label className="flex items-center justify-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={noted}
          onChange={(e) => setNoted(e.target.checked)}
        />
        Anotei o código
      </label>
      <Button
        size="lg"
        className="w-full"
        disabled={!noted}
        onClick={() => signIn(result!)}
      >
        <Check /> Começar a usar
      </Button>
    </div>
  );
}
