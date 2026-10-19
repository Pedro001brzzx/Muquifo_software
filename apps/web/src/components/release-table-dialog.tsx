import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/errors';
import { tableLabel } from '@/lib/format';

const reasons = [
  'Mesa aberta por engano',
  'Cliente foi embora sem consumir',
  'Cliente trocou de mesa',
];

export interface ReleasableTab {
  id: string;
  code: number;
  tableNumber: number | null;
}

/**
 * Segunda validação antes de liberar a mesa: a comanda sem consumo é cancelada
 * com motivo (fica registrada) e a mesa volta a ficar livre.
 */
export function ReleaseTableDialog({
  tab,
  onClose,
  onReleased,
}: {
  tab: ReleasableTab | null;
  onClose: () => void;
  onReleased?: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(reasons[0]);
  useEffect(() => {
    if (tab) setReason(reasons[0]);
  }, [tab]);

  const release = useMutation({
    mutationFn: (t: ReleasableTab) =>
      api.cancelTab(t.id, { reason: reason.trim() }),
    onSuccess: (result, t) => {
      qc.setQueryData(['tab', result.id], result);
      void qc.invalidateQueries({ queryKey: ['tabs'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
      toast.success(
        t.tableNumber !== null
          ? `Mesa ${tableLabel(t.tableNumber)} liberada`
          : `Comanda ${t.code} cancelada`,
      );
      onClose();
      onReleased?.();
    },
    onError: toastError,
  });

  const place =
    tab?.tableNumber != null ? `mesa ${tableLabel(tab.tableNumber)}` : null;
  const valid = reason.trim().length >= 3;

  return (
    <AlertDialog
      open={!!tab}
      onOpenChange={(o) => !o && !release.isPending && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-1 grid size-12 place-items-center rounded-full bg-busy/15 text-busy sm:mx-0">
            <DoorOpen className="size-6" />
          </div>
          <AlertDialogTitle>
            {place ? `Liberar a ${place}?` : `Cancelar a comanda ${tab?.code}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            A comanda {tab?.code} não tem consumo e será cancelada
            {place && `; a ${place} volta a ficar livre`}. O cancelamento fica
            registrado com o motivo e não pode ser desfeito.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="release-reason">Motivo</Label>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => (
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
            id="release-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={release.isPending}>
            Voltar
          </AlertDialogCancel>
          {/* Button comum (não AlertDialogAction) para o diálogo só fechar depois da resposta. */}
          <Button
            variant="destructive"
            disabled={!valid || release.isPending}
            onClick={() => tab && release.mutate(tab)}
          >
            {release.isPending && <Loader2 className="animate-spin" />}
            {place ? 'Sim, liberar mesa' : 'Sim, cancelar comanda'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
