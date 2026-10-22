import { useQuery } from '@tanstack/react-query';
import {
  LayoutGrid,
  type LucideIcon,
  Package,
  ReceiptText,
  Settings2,
  UtensilsCrossed,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { API_URL, api, queryKeys } from '@/api';
import { ThemeToggle } from '@/components/theme';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const nav: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Salão', icon: LayoutGrid, end: true },
  { to: '/comandas', label: 'Comandas', icon: ReceiptText },
  { to: '/produtos', label: 'Produtos', icon: Package },
  { to: '/cadastros', label: 'Cadastros', icon: Settings2 },
];

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
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-5 py-5">
        <Brand />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {nav.map(({ to, label, icon: Icon, end }) => (
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
      <div className="flex items-center justify-between border-t px-4 py-3">
        <ConnectionStatus />
        <ThemeToggle />
      </div>
    </aside>
  );
}

function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground',
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
  return (
    <div className="min-h-dvh">
      <SideNav />
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ConnectionStatus compact />
          <ThemeToggle />
        </div>
      </header>
      <main className="pb-24 md:pb-0 md:pl-60">
        <Outlet />
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
