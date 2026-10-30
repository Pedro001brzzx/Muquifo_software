import {
  roleRank,
  type User,
  type UserRole,
  userRoleLabel,
} from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Armchair, Lock, Pencil, Plus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { Avatar } from '@/components/avatar';
import { Field, FormDialog } from '@/components/form-dialog';
import { PageBody, PageHeader } from '@/components/layout';
import {
  EmptyState,
  tableStatusColor,
  tableStatusLabel,
} from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth';
import { toastError } from '@/lib/errors';
import { tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Cadastros gerais: equipe e mesas. O cardápio tem tela própria em Produtos. */
export function RegistryPage() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Cadastros"
        description="Equipe (quem entra com PIN) e mesas do salão."
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing('new')}>
              <UserPlus /> Pessoa
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Mesa
            </Button>
          </>
        }
      />
      <PageBody className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Equipe</h2>
          <TeamSection onEdit={setEditing} />
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Mesas</h2>
          <TablesSection />
        </section>
      </PageBody>
      <TableDialog open={creating} onClose={() => setCreating(false)} />
      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

const roleHelp: Record<UserRole, string> = {
  waiter: 'Salão e comandas: abre mesa, lança e envia pedidos.',
  cashier: 'Tudo do garçom, mais receber, fechar conta e o caixa.',
  owner: 'Tudo: painel, cardápio, equipe e autorizar cancelamentos e estornos.',
};

const roles: UserRole[] = ['waiter', 'cashier', 'owner'];

function TeamSection({ onEdit }: { onEdit: (user: User) => void }) {
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: queryKeys.users, queryFn: api.users });
  if (users.isLoading) return <Skeleton className="h-28 rounded-xl" />;
  const list = [...(users.data ?? [])].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      roleRank[b.role] - roleRank[a.role],
  );
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((u) => (
        <li key={u.id}>
          <button
            type="button"
            onClick={() => onEdit(u)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:bg-accent',
              !u.active && 'opacity-55',
            )}
          >
            <Avatar user={u} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {u.name}
                {u.id === me?.id && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    (você)
                  </span>
                )}
              </span>
              <span className="block text-sm text-muted-foreground">
                {userRoleLabel[u.role]}
              </span>
              {!u.active ? (
                <span className="text-xs text-muted-foreground">
                  Desativado
                </span>
              ) : u.lockedUntil ? (
                <span className="flex items-center gap-1 text-xs text-destructive">
                  <Lock className="size-3" /> Bloqueado por PIN errado até{' '}
                  {new Date(u.lockedUntil).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              ) : null}
            </span>
            <Pencil className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Cadastra ou altera alguém da equipe. Trocar o PIN desbloqueia. */
function UserDialog({
  user,
  onClose,
}: {
  user: User | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [role, setRole] = useState<UserRole>(user?.role ?? 'waiter');
  const [active, setActive] = useState(user?.active ?? true);
  const [pinError, setPinError] = useState('');
  const save = useMutation({
    mutationFn: (data: FormData) => {
      const name = String(data.get('name')).trim();
      const pin = String(data.get('pin') ?? '');
      return user
        ? api.updateUser(user.id, {
            version: user.version,
            name,
            role,
            active,
            ...(pin ? { pin } : {}),
          })
        : api.createUser({ name, role, pin });
    },
    onSuccess: (u) => {
      toast.success(user ? `${u.name} atualizado` : `${u.name} cadastrado`);
      void qc.invalidateQueries({ queryKey: queryKeys.users });
      void qc.invalidateQueries({ queryKey: queryKeys.authStatus });
      onClose();
    },
    onError: toastError,
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={user ? `Editar ${user.name}` : 'Nova pessoa na equipe'}
      description={
        user
          ? 'Trocar o PIN, a função ou desativar desconecta os aparelhos dessa pessoa.'
          : 'Ela entra tocando no nome e digitando o PIN.'
      }
      pending={save.isPending}
      onSubmit={(data) => {
        const pin = String(data.get('pin') ?? '');
        if ((pin || !user) && !/^\d{4,6}$/.test(pin)) {
          setPinError('O PIN tem de 4 a 6 números.');
          return;
        }
        save.mutate(data);
      }}
    >
      <Field label="Nome" htmlFor="user-name">
        <Input
          id="user-name"
          name="name"
          required
          maxLength={40}
          autoFocus={!user}
          defaultValue={user?.name}
          placeholder="Ex.: Ana"
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Função</legend>
        {roles.map((r) => (
          <label
            key={r}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
              role === r && 'border-primary bg-primary/5',
            )}
          >
            <input
              type="radio"
              name="role"
              value={r}
              checked={role === r}
              onChange={() => setRole(r)}
              className="mt-1 accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">{userRoleLabel[r]}</span>
              <span className="block text-sm text-muted-foreground">
                {roleHelp[r]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field
        label={user ? 'PIN novo (deixe vazio para manter)' : 'PIN'}
        htmlFor="user-pin"
        hint="4 a 6 números. A própria pessoa pode digitar."
        error={pinError || null}
      >
        <Input
          id="user-pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          className="font-mono tracking-widest"
          onChange={() => setPinError('')}
        />
      </Field>
      {user && (
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span>
            <span className="block font-medium">Ativo</span>
            <span className="block text-sm text-muted-foreground">
              Desativado não aparece na entrada nem consegue entrar.
            </span>
          </span>
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      )}
    </FormDialog>
  );
}

function TablesSection() {
  const tables = useQuery({ queryKey: queryKeys.tables, queryFn: api.tables });
  if (tables.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!tables.data?.length) {
    return <EmptyState icon={Armchair} title="Nenhuma mesa cadastrada" />;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tables.data.map((t) => (
        <div key={t.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between">
            <span className="text-2xl font-semibold tabular">
              {tableLabel(t.number)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'size-2 rounded-full',
                  tableStatusColor[t.status],
                )}
              />
              {tableStatusLabel[t.status]}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span className="truncate">{t.label ?? '—'}</span>
            {t.seats && (
              <span className="flex items-center gap-1">
                <Users className="size-3.5" /> {t.seats}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: api.createTable,
    onSuccess: (t) => {
      toast.success(`Mesa ${tableLabel(t.number)} cadastrada`);
      void qc.invalidateQueries({ queryKey: queryKeys.tables });
      onClose();
    },
    onError: toastError,
  });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Nova mesa"
      pending={create.isPending}
      onSubmit={(d) =>
        create.mutate({
          number: Number(d.get('number')),
          label: String(d.get('label')).trim() || null,
          seats: d.get('seats') ? Number(d.get('seats')) : null,
        })
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Número" htmlFor="table-number">
          <Input
            id="table-number"
            name="number"
            type="number"
            min={1}
            max={9999}
            required
            autoFocus
          />
        </Field>
        <Field label="Lugares" htmlFor="table-seats">
          <Input
            id="table-seats"
            name="seats"
            type="number"
            min={1}
            max={100}
          />
        </Field>
      </div>
      <Field label="Rótulo (opcional)" htmlFor="table-label">
        <Input
          id="table-label"
          name="label"
          maxLength={60}
          placeholder="Ex.: Varanda"
        />
      </Field>
    </FormDialog>
  );
}
