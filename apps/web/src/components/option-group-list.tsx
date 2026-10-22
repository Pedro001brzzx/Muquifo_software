import { formatCents, type OptionGroup } from '@muquifo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ListPlus,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
import { ruleLabel } from '@/components/option-groups';
import { EmptyState } from '@/components/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toastError } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** Onde o grupo aparece: categorias, produtos ou aberto por opção de outro grupo. */
const usage = (g: OptionGroup, all: OptionGroup[] = []) => {
  const openers = all.filter((x) =>
    x.options.some((o) => o.childGroupId === g.id),
  );
  const parts = [
    g.categoryCount > 0 &&
      `${g.categoryCount} categoria${g.categoryCount > 1 ? 's' : ''}`,
    g.productCount > 0 &&
      `${g.productCount} produto${g.productCount > 1 ? 's' : ''}`,
    openers.length > 0 && `aberto por ${openers.map((x) => x.name).join(', ')}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'não ligado';
};

/** Grupos de complementos em cartões: regra, onde é usado e opções com preço. */
export function OptionGroupList({
  onEdit,
  onCreate,
  onKit,
}: {
  onEdit: (g: OptionGroup) => void;
  onCreate: () => void;
  onKit: () => void;
}) {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<OptionGroup | null>(null);
  const groups = useQuery({
    queryKey: [...queryKeys.optionGroups, 'all'],
    queryFn: () => api.optionGroups({ status: 'all' }),
  });
  const toggle = useMutation({
    mutationFn: (g: OptionGroup) =>
      api.updateOptionGroup(g.id, { version: g.version, active: !g.active }),
    onSuccess: (g) => {
      toast.success(
        g.active ? `Grupo ${g.name} restaurado` : `Grupo ${g.name} arquivado`,
      );
      setArchiving(null);
    },
    onError: toastError,
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.optionGroups }),
  });

  const visible = (groups.data ?? []).filter((g) => g.active !== showArchived);
  const archivedCount = (groups.data ?? []).filter((g) => !g.active).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Crie o grupo uma vez e ligue a produtos (na edição do produto) ou a
          uma categoria inteira (na edição da categoria). Mudanças aqui valem
          para todos os lugares onde o grupo está ligado.
        </p>
        <Tabs
          value={showArchived ? 'archived' : 'active'}
          onValueChange={(v) => setShowArchived(v === 'archived')}
        >
          <TabsList>
            <TabsTrigger value="active">Ativos</TabsTrigger>
            <TabsTrigger value="archived">
              Arquivados{archivedCount > 0 && ` (${archivedCount})`}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {groups.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ListPlus}
          title={
            showArchived
              ? 'Nenhum grupo arquivado'
              : 'Nenhum grupo de complementos'
          }
          description={
            showArchived
              ? undefined
              : 'Ex.: Ponto da carne, Adicionais, Retirar ingredientes, Borda.'
          }
          action={
            !showArchived && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={onKit}>
                  <Sparkles /> Usar modelo de lanchonete
                </Button>
                <Button variant="outline" onClick={onCreate}>
                  <Plus /> Criar do zero
                </Button>
              </div>
            )
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g) => (
            <article
              key={g.id}
              className={cn(
                'flex flex-col rounded-xl border bg-card',
                !g.active && 'opacity-70',
              )}
            >
              <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => onEdit(g)}
                >
                  <h3 className="truncate font-semibold">{g.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant={g.minSelect > 0 ? 'default' : 'secondary'}>
                      {ruleLabel(g)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {usage(g, groups.data)}
                    </span>
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Ações de ${g.name}`}
                    >
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEdit(g)}>
                      <Pencil /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {g.active ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setArchiving(g)}
                      >
                        <Archive /> Arquivar
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => toggle.mutate(g)}>
                        <ArchiveRestore /> Restaurar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ul className="flex-1 space-y-1 px-4 py-3 text-sm">
                {g.options.slice(0, 6).map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className={cn(
                        'truncate',
                        !o.available && 'text-muted-foreground line-through',
                      )}
                    >
                      {o.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {!o.available
                        ? 'em falta'
                        : o.priceCents
                          ? `+${formatCents(o.priceCents)}`
                          : 'sem custo'}
                    </span>
                  </li>
                ))}
                {g.options.length > 6 && (
                  <li className="text-xs text-muted-foreground">
                    + {g.options.length - 6} opções
                  </li>
                )}
              </ul>
            </article>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!archiving}
        onOpenChange={(o) => !o && !toggle.isPending && setArchiving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Arquivar o grupo {archiving?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiving && usage(archiving, groups.data) !== 'não ligado'
                ? `Ele deixa de ser oferecido em ${usage(archiving, groups.data)}. `
                : ''}
              Pedidos antigos continuam mostrando os complementos escolhidos.
              Você pode restaurar depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggle.isPending}>
              Voltar
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={toggle.isPending}
              onClick={() => archiving && toggle.mutate(archiving)}
            >
              {toggle.isPending && <Loader2 className="animate-spin" />}
              Sim, arquivar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
