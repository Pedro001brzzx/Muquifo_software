import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { setApprovalPrompt } from '@/api';
import { PinPad } from '@/components/pin-pad';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Pending {
  action: string;
  error?: string;
  resolve: (pin: string | null) => void;
}

/**
 * "Autorização do gerente": quando a API recusa uma ação sensível por falta
 * do PIN de um dono/gerente, este diálogo aparece; com o PIN, a ação é
 * repetida sozinha (mesma Idempotency-Key, então nada é feito duas vezes).
 */
export function ApprovalDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [pin, setPin] = useState('');
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    setApprovalPrompt(
      (request) =>
        new Promise<string | null>((resolve) => {
          setPin('');
          setPending({ ...request, resolve });
        }),
    );
    return () => setApprovalPrompt(null);
  }, []);

  const finish = (value: string | null) => {
    pendingRef.current?.resolve(value);
    setPending(null);
    setPin('');
  };

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => !open && finish(null)}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <ShieldCheck className="size-10 text-primary" />
          <DialogTitle>Autorização do gerente</DialogTitle>
          <DialogDescription>
            {pending?.action
              ? `Para ${pending.action}, um dono ou gerente digita o PIN dele.`
              : 'Um dono ou gerente precisa digitar o PIN dele.'}
          </DialogDescription>
        </DialogHeader>
        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={() => finish(pin)}
          error={pending?.error ?? null}
          submitLabel="Autorizar"
        />
      </DialogContent>
    </Dialog>
  );
}
