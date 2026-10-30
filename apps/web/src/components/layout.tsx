import { hasRole, type UserRole, userRoleLabel } from '@muquifo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChartColumn,
  ChevronsUpDown,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Package,
  ReceiptText,
  Settings2,
  Smartphone,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { type ReactNode, Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { API_URL, api, queryKeys } from '@/api';
import { Avatar } from '@/components/avatar';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth, useCan } from '@/lib/auth';
import { useNetwork } from '@/lib/network';
import { cn } from '@/lib/utils';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Função mínima para ver o item (sem = toda a equipe). */
  min?: UserRole;
};

const nav: NavItem[] = [
  { to: '/', label: 'Salão', icon: LayoutGrid, end: true },
  { to: '/comandas', label: 'Comandas', icon: ReceiptText },
  { to: '/caixa', label: 'Caixa', icon: Wallet, min: 'cashier' },
  { to: '/painel', label: 'Painel', icon: ChartColumn, min: 'owner' },
  { to: '/produtos', label: 'Produtos', icon: Package, min: 'owner' },
  { to: '/cadastros', label: 'Cadastros', icon: Settings2, min: 'owner' },
];

/** Fora da barra de baixo (já cheia); no celular vira ícone no topo. */
const connectNav: NavItem = {
  to: '/conectar',
  label: 'Celulares',
  icon: Smartphone,
  min: 'owner',
};

/** Itens do menu que a função do usuário logado pode abrir. */
function useNav(items: NavItem[]) {
  const { user } = useAuth();
  return items.filter((i) => !i.min || (user && hasRole(user.role, i.min)));
}

/**
 * O IP dos QR codes e celulares deixou de ser desta máquina: avisa em todas
 * as telas, porque os celulares dos garçons podem ter parado.
 */
function AddressAlert() {
  const network = useNetwork({ enabled: useCan('owner') });
  const { pathname } = useLocation();
  const change = network.data?.pendingChange;
  if (!(change || network.data?.addressChanged) || pathname === connectNav.to) {
    return null;
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm md:px-8"
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <span className="flex-1">
        {change ? (
          <>
            O endereço do sistema mudou para{' '}
            <b className="font-mono">{change.to}</b> e já foi ajustado. QR codes
            impressos e atalhos nos celulares precisam ser refeitos.
          </>
        ) : (
          'O endereço do sistema mudou. QR codes e celulares podem ter parado de abrir.'
        )}
      </span>
      <Link
        to={connectNav.to}
        className="font-semibold text-destructive underline underline-offset-2"
      >
        Resolver
      </Link>
    </div>
  );
}

/**
 * Quem está usando este aparelho. "Trocar usuário" volta à tela de nomes
 * (aparelho compartilhado no caixa); a sessão deste usuário é encerrada.
 */
function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  // O próximo a entrar começa no Salão, não na tela de quem saiu (que pode
  // nem ser permitida para ele).
  const switchUser = () => {
    void navigate('/', { replace: true });
    signOut();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Usuário: ${user.name}`}
          >
            <Avatar user={user} size="sm" />
          </Button>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
          >
            <Avatar user={user} size="sm" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">
                {user.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {userRoleLabel[user.role]}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          {user.name}
          <span className="block text-xs font-normal text-muted-foreground">
            {userRoleLabel[user.role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={switchUser}>
          <Users /> Trocar usuário
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={switchUser}>
          <LogOut /> Sair deste aparelho
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <UtensilsCrossed className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight">Muquifo</div>
        <div className="text-xs text-muted-foreground">Gestão do salão</div>
      </div>
    </div>
  );
}

export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    refetchInterval: 5_000,
    retry: false,
  });
  const state = health.isError
    ? { tone: 'bg-destructive', text: 'Servidor inacessível' }
    : health.data?.database === 'down'
      ? { tone: 'bg-busy', text: 'Servidor sem banco de dados' }
      : health.data
        ? { tone: 'bg-free', text: 'Conectado ao servidor' }
        : { tone: 'bg-muted-foreground', text: 'Conectando…' };

  const dot = (
    <span className="relative flex size-2.5">
      {health.data && !health.isError && (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-40',
            state.tone,
          )}
        />
      )}
      <span
        className={cn('relative inline-flex size-2.5 rounded-full', state.tone)}
      />
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          {dot}
          {!compact && <span>{state.text}</span>}
          {compact && <span className="sr-only">{state.text}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {state.text}
        {health.data && ` · API v${health.data.version}`}
        <br />
        {API_URL}
      </TooltipContent>
    </Tooltip>
  );
}

function SideNav() {
  const items = useNav([...nav, connectNav]);
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-5 py-5">
        <Brand />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive &&
                  'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
              )
            }
          >
            <Icon className="size-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t px-3 py-3">
        <UserMenu />
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <ConnectionStatus />
        <ThemeToggle />
      </div>
    </aside>
  );
}

function BottomNav() {
  const items = useNav(nav);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted-foreground',
              isActive && 'text-primary',
            )
          }
        >
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const canConnect = useCan('owner');
  return (
    <div className="min-h-dvh">
      <SideNav />
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ConnectionStatus compact />
          {canConnect && (
            <Button variant="ghost" size="icon" asChild>
              <Link to={connectNav.to} aria-label="Celulares e tablets">
                <Smartphone />
              </Link>
            </Button>
          )}
          <ThemeToggle />
          <UserMenu compact />
        </div>
      </header>
      <main className="pb-24 md:pb-0 md:pl-60">
        <AddressAlert />
        {/* Tela ainda carregando: menu e barra continuam no lugar. */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b bg-background px-4 py-5 md:px-8 md:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function PageBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('px-4 py-5 md:px-8 md:py-6', className)}>{children}</div>
  );
}
