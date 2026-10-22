import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Armchair, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, queryKeys } from '@/api';
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
import { toastError } from '@/lib/errors';
import { tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Cadastros gerais. O cardápio tem tela própria em Produtos. */
export function RegistryPage() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Cadastros"
        description="Mesas do salão."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Mesa
          </Button>
        }
      />
      <PageBody>
        <TablesSection />
      </PageBody>
      <TableDialog open={creating} onClose={() => setCreating(false)} />
    </>
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
