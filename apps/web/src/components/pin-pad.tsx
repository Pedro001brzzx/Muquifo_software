import { Check, Delete, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

export const PIN_MIN = 4;
export const PIN_MAX = 6;

/**
 * Teclado numérico grande (dedo no celular, ou teclado do computador). Os
 * números não aparecem: só bolinhas. `onSubmit` no ✓ ou no Enter.
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  busy,
  error,
  submitLabel = 'Entrar',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  submitLabel?: string;
}) {
  const ready = value.length >= PIN_MIN;
  const press = (digit: string) => {
    if (busy || value.length >= PIN_MAX) return;
    onChange(value + digit);
  };
  const erase = () => !busy && onChange(value.slice(0, -1));

  // Teclado físico também funciona (computador do caixa).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') erase();
      else if (e.key === 'Enter' && ready && !busy) onSubmit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-5">
      <div
        className="flex h-6 items-center gap-3"
        role="status"
        aria-label={`${value.length} números digitados`}
      >
        {Array.from({ length: Math.max(PIN_MIN, value.length) }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full border-2 border-foreground/40 transition',
              i < value.length && 'scale-110 border-primary bg-primary',
              error && 'border-destructive',
            )}
          />
        ))}
      </div>
      <p
        className={cn(
          'min-h-5 text-center text-sm',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}
        role={error ? 'alert' : undefined}
      >
        {error ?? `PIN de ${PIN_MIN} a ${PIN_MAX} números`}
      </p>
      <div className="grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => press(d)} disabled={busy}>
            {d}
          </Key>
        ))}
        <Key onClick={erase} disabled={busy || !value} label="Apagar">
          <Delete className="size-6" />
        </Key>
        <Key onClick={() => press('0')} disabled={busy}>
          0
        </Key>
        <Key
          onClick={onSubmit}
          disabled={busy || !ready}
          label={submitLabel}
          primary
        >
          {busy ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <Check className="size-7" />
          )}
        </Key>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  disabled,
  label,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-16 place-items-center rounded-2xl border bg-card text-2xl font-semibold shadow-xs transition select-none active:scale-95 disabled:opacity-40',
        primary &&
          'border-primary bg-primary text-primary-foreground disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
