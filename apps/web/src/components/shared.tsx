import type {
  DiningTable,
  OrderStatus,
  TableStatus,
  TabStatus,
} from '@muquifo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, type LucideIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toastError } from '@/lib/errors';
import { tableLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export const tableStatusLabel: Record<TableStatus, string> = {
  free: 'Livre',
  occupied: 'Ocupada',
  closing: 'Fechando conta',
};

export const tableStatusColor: Record<TableStatus, string> = {
  free: 'bg-free',
  occupied: 'bg-busy',
  closing: 'bg-closing',
};

const tabStatus: Record<TabStatus, { label: string; className: string }> = {
  open: { label: 'Aberta', className: 'bg-free/15 text-free border-free/30' },
  closing: {
    label: 'Fechando conta',
    className: 'bg-closing/15 text-closing border-closing/30',
  },
  closed: { label: 'Fechada', className: 'bg-muted text-muted-foreground' },
  canceled: {
    label: 'Cancelada',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
};

const orderStatus: Record<OrderStatus, { label: string; className: string }> = {
  draft: {
    label: 'Rascunho',
    className: 'bg-muted text-muted-foreground border-dashed',
  },
  submitted: {
    label: 'Enviado',
    className: 'bg-primary/15 text-primary border-primary/30',
  },
  canceled: {
    label: 'Cancelado',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
};

export function TabStatusBadge({ status }: { status: TabStatus }) {
  const s = tabStatus[status];
  return (
    <Badge variant="outline" className={s.className}>
      {s.label}
    </Badge>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = orderStatus[status];
  return (
    <Badge variant="outline" className={s.className}>
      {s.label}
    </Badge>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Abre comanda numa mesa (ou avulsa, para balcão/retirada) e vai para ela. */
export function OpenTabDialog({
  table,
  open,
  onOpenChange,
}: {
  table: DiningTable | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState('');
  const openTab = useMutation({
    mutationFn: api.openTab,
    onSuccess: (tab) => {
      void qc.invalidateQueries({ queryKey: ['tabs'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
      qc.setQueryData(['tab', tab.id], tab);
      onOpenChange(false);
      setCustomerName('');
      navigate(`/comandas/${tab.id}`);
    },
    onError: toastError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    openTab.mutate({
      tableId: table?.id ?? null,
      customerName: customerName.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {table
                ? `Abrir comanda · Mesa ${tableLabel(table.number)}`
                : 'Comanda avulsa'}
            </DialogTitle>
            <DialogDescription>
              {table
                ? 'A mesa passa a aparecer como ocupada.'
                : 'Para balcão, retirada ou entrega, sem mesa.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="customerName">Nome do cliente (opcional)</Label>
            <Input
              id="customerName"
              autoFocus
              maxLength={120}
              placeholder="Ex.: Ana"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={openTab.isPending}>
              {openTab.isPending && <Loader2 className="animate-spin" />}
              Abrir comanda
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
