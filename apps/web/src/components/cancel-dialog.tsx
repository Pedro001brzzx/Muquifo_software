import type { Order, OrderItem } from '@muquifo/contracts';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatQuantity } from '@/lib/format';

const quickReasons = [
  'Cliente desistiu',
  'Lançado por engano',
  'Item em falta',
  'Demora no preparo',
];

export interface CancelTarget {
  order: Order;
  /** Sem item: cancela todos os itens ativos do pedido. */
  item?: OrderItem;
}

export function CancelDialog({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: CancelTarget | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (target) setReason('');
  }, [target]);

  const valid = reason.trim().length >= 3;
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) onConfirm(reason.trim());
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {target?.item
                ? `Cancelar ${formatQuantity(target.item.quantity)}× ${target.item.productName}`
                : `Cancelar pedido #${target?.order.number}`}
            </DialogTitle>
            <DialogDescription>
              O cancelamento fica registrado com motivo e horário; nada é
              apagado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reason">Motivo</Label>
            <div className="flex flex-wrap gap-1.5">
              {quickReasons.map((r) => (
                <Badge
                  key={r}
                  asChild
                  variant={reason === r ? 'default' : 'outline'}
                  className="cursor-pointer px-2.5 py-1"
                >
                  <button type="button" onClick={() => setReason(r)}>
                    {r}
                  </button>
                </Badge>
              ))}
            </div>
            <Textarea
              id="reason"
              rows={3}
              maxLength={300}
              placeholder="Descreva o motivo (mínimo 3 caracteres)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Voltar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!valid || pending}
            >
              {pending && <Loader2 className="animate-spin" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
